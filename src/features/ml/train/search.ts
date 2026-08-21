/**
 * Seeded random hyperparameter search with stratified k-fold cross-validation.
 * The search only ever sees the TRAIN split: the pipeline is refitted inside
 * each fold (no leakage), the winning configuration is refitted on the full
 * train split, and the held-out test set is scored exactly once at the end.
 */
import { GBDT_DEFAULTS, trainGbdtClassifier, trainGbdtRegressor } from '@/features/ml/train/gbdt';
import { defaultMlpParams, trainMlp } from '@/features/ml/train/mlp';
import {
  MODEL_TRAIN_CAPS,
  trainForest,
  trainKnn,
  type ModelContext,
  type TrainedModel,
} from '@/features/ml/train/models';
import { fitPipeline } from '@/features/ml/train/pipeline';
import { mulberry32, nestedSampleOrder, shuffleInPlace } from '@/features/ml/train/random';
import { prepareData, scoreModel, yieldToQueue } from '@/features/ml/train/trainer';
import type { Cell, ColumnProfile } from '@/features/ml/data/types';
import type { MetricMap, ModelKey, TrainConfig } from '@/features/ml/train/types';

export const TUNABLE_KEYS = ['gbdt', 'forest', 'knn', 'mlp'] as const;
export type TunableKey = (typeof TUNABLE_KEYS)[number];

export const SEARCH_BUDGET = 16;
export const SEARCH_FOLDS = 3;

export interface TuneTrial {
  params: Record<string, number>;
  cvScore: number;
}

export interface TuneOutcome {
  model: TunableKey;
  isClassification: boolean;
  folds: number;
  /** Configurations actually evaluated (grid size caps the budget). */
  budget: number;
  bestParams: Record<string, number>;
  /** Mean CV score of the winner (accuracy, or RMSE for regression). */
  bestCv: number;
  /** Test primary of the default-configuration model from the run (NaN if it failed). */
  defaultPrimary: number;
  tunedPrimary: number;
  tunedMetrics: MetricMap;
  /** Best trials first, capped for display. */
  trials: TuneTrial[];
  totalMs: number;
  /** V25: train rows the search actually used (folds + final refit). */
  trainedRows: number;
  /** V25: full train-split size when the family cap engaged — announced, never silent. */
  sampledFrom?: number;
}

const SPACES: Record<TunableKey, Record<string, number[]>> = {
  gbdt: { learningRate: [0.03, 0.05, 0.1, 0.2], maxDepth: [2, 3, 4, 6], nRounds: [60, 120, 240] },
  forest: { nEstimators: [20, 40, 80], maxDepth: [4, 8, 12, 16] },
  knn: { k: [1, 3, 5, 9, 15, 25] },
  mlp: { hidden: [8, 16, 32, 64], learningRate: [0.003, 0.01, 0.03], epochs: [150, 300] },
};

const TRIALS_SHOWN = 5;

export function isTunable(key: ModelKey): key is TunableKey {
  return (TUNABLE_KEYS as readonly string[]).includes(key);
}

/** Every combination of the space, in a deterministic order. */
export function cartesianGrid(space: Record<string, number[]>): Record<string, number>[] {
  let combos: Record<string, number>[] = [{}];
  for (const [name, values] of Object.entries(space)) {
    combos = combos.flatMap((combo) => values.map((value) => ({ ...combo, [name]: value })));
  }
  return combos;
}

/** Seeded sample of `budget` configurations without replacement. */
export function sampleConfigs(
  space: Record<string, number[]>,
  budget: number,
  seed: number,
): Record<string, number>[] {
  const grid = cartesianGrid(space);
  if (grid.length <= budget) return grid;
  return shuffleInPlace(grid, mulberry32(seed)).slice(0, budget);
}

/**
 * Deterministic k-fold assignment. Classification folds are stratified: each
 * label's rows are shuffled (seeded) and dealt round-robin across folds.
 */
export function kfoldIndices(
  indices: number[],
  labels: (string | null)[] | null,
  folds: number,
  seed: number,
): number[][] {
  const rng = mulberry32(seed);
  const result: number[][] = Array.from({ length: folds }, () => []);
  const groups = new Map<string, number[]>();
  if (labels) {
    indices.forEach((index, position) => {
      const label = labels[position] ?? '';
      const group = groups.get(label);
      if (group) group.push(index);
      else groups.set(label, [index]);
    });
  } else {
    groups.set('', [...indices]);
  }
  let dealt = 0;
  for (const key of [...groups.keys()].sort()) {
    const group = shuffleInPlace(groups.get(key)!, rng);
    for (const index of group) {
      result[dealt % folds].push(index);
      dealt += 1;
    }
  }
  return result;
}

function trainWith(
  key: TunableKey,
  X: number[][],
  y: number[],
  ctx: ModelContext,
  params: Record<string, number>,
): TrainedModel {
  if (key === 'gbdt') {
    const merged = { ...GBDT_DEFAULTS, ...params };
    if (ctx.task === 'regression') {
      const model = trainGbdtRegressor(X, y, merged);
      return { predict: (rows) => model.predictRaw(rows) };
    }
    const model = trainGbdtClassifier(X, y, ctx.classCount, merged);
    return {
      predict: (rows) => model.proba(rows).map((p) => p.indexOf(Math.max(...p))),
      predictProba: (rows) => model.proba(rows),
    };
  }
  if (key === 'forest') {
    return trainForest(X, y, ctx, { nEstimators: params.nEstimators, maxDepth: params.maxDepth });
  }
  if (key === 'knn') {
    return trainKnn(X, y, ctx, params.k);
  }
  const defaults = defaultMlpParams(X.length, X[0]?.length ?? 0);
  const merged = { ...defaults, ...params };
  if (ctx.task === 'regression') {
    const model = trainMlp(X, y, 0, ctx.seed, merged);
    return { predict: (rows) => model.forward(rows).map((p) => p[0]) };
  }
  const model = trainMlp(X, y, ctx.classCount, ctx.seed, merged);
  return {
    predict: (rows) => model.forward(rows).map((p) => p.indexOf(Math.max(...p))),
    predictProba: (rows) => model.forward(rows),
  };
}

export interface SearchCallbacks {
  onProgress(done: number, total: number, bestCv: number | null): void;
  isCancelled(): boolean;
}

export async function runSearch(
  columns: Map<string, Cell[]>,
  profiles: ColumnProfile[],
  config: TrainConfig,
  modelKey: TunableKey,
  defaultModel: TrainedModel | null,
  callbacks: SearchCallbacks,
): Promise<TuneOutcome | null> {
  const startedAt = performance.now();
  const prepared = prepareData(columns, profiles, config);
  const { isClassification, classes, featureColumns, test, encode } = prepared;
  const higherIsBetter = isClassification;

  // V25: the tuned family searches on the same announced seeded sample the
  // trainer used (same caps, same seed, same nested order) — so CV folds stay
  // affordable and the tuned model is comparable to the leaderboard's default.
  let { train, trainLabels } = prepared;
  const cap = MODEL_TRAIN_CAPS[modelKey];
  let sampledFrom: number | undefined;
  if (cap !== undefined && train.length > cap) {
    sampledFrom = train.length;
    const keep = nestedSampleOrder(train.length, trainLabels, config.seed)
      .slice(0, cap)
      .sort((a, b) => a - b);
    const fullTrain = train;
    train = keep.map((position) => fullTrain[position]);
    if (trainLabels) {
      const labels = trainLabels;
      trainLabels = keep.map((position) => labels[position]);
    }
  }

  const context: ModelContext = {
    task: isClassification ? 'classification' : 'regression',
    classCount: classes.length,
    seed: config.seed,
  };

  const configs = sampleConfigs(SPACES[modelKey], SEARCH_BUDGET, config.seed);
  const folds = kfoldIndices(train, trainLabels, SEARCH_FOLDS, config.seed);

  // Fold pipelines and matrices are shared by every configuration.
  const foldData = folds.map((validation, f) => {
    const trainIdx = folds.filter((_, other) => other !== f).flat();
    const pipeline = fitPipeline(columns, profiles, featureColumns, trainIdx);
    return {
      trainX: pipeline.transform(trainIdx),
      trainY: trainIdx.map(encode),
      valX: pipeline.transform(validation),
      valY: validation.map(encode),
    };
  });

  const trials: TuneTrial[] = [];
  let bestCv: number | null = null;
  const total = configs.length * SEARCH_FOLDS;
  let done = 0;

  for (const params of configs) {
    let sum = 0;
    for (const fold of foldData) {
      if (callbacks.isCancelled()) return null;
      const model = trainWith(modelKey, fold.trainX, fold.trainY, context, params);
      const { primary } = scoreModel(model, fold.valX, fold.valY, isClassification, classes.length);
      sum += primary;
      done += 1;
      callbacks.onProgress(done, total, bestCv);
      await yieldToQueue();
    }
    const cvScore = sum / foldData.length;
    trials.push({ params, cvScore });
    if (bestCv === null || (higherIsBetter ? cvScore > bestCv : cvScore < bestCv)) {
      bestCv = cvScore;
    }
  }

  trials.sort((a, b) => (higherIsBetter ? b.cvScore - a.cvScore : a.cvScore - b.cvScore));
  const best = trials[0];

  // Refit the winner on the (possibly capped, announced) train split; the
  // held-out test set is scored exactly once.
  const pipeline = fitPipeline(columns, profiles, featureColumns, train);
  const trainX = pipeline.transform(train);
  const trainY = train.map(encode);
  const testX = pipeline.transform(test);
  const testY = test.map(encode);
  const tuned = trainWith(modelKey, trainX, trainY, context, best.params);
  const tunedScore = scoreModel(tuned, testX, testY, isClassification, classes.length);
  const defaultScore = defaultModel
    ? scoreModel(defaultModel, testX, testY, isClassification, classes.length)
    : null;

  return {
    model: modelKey,
    isClassification,
    folds: SEARCH_FOLDS,
    budget: configs.length,
    bestParams: best.params,
    bestCv: best.cvScore,
    defaultPrimary: defaultScore?.primary ?? Number.NaN,
    tunedPrimary: tunedScore.primary,
    tunedMetrics: tunedScore.metrics,
    trials: trials.slice(0, TRIALS_SHOWN),
    totalMs: performance.now() - startedAt,
    trainedRows: train.length,
    ...(sampledFrom !== undefined && { sampledFrom }),
  };
}

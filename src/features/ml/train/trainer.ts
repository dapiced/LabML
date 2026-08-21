import { isMissing, parseNumber } from '@/features/ml/data/infer';
import { detectTask } from '@/features/ml/data/suggest';
import { accuracy, logLoss, macroPrf, mae, r2, rmse, rocAuc } from '@/features/ml/train/metrics';
import { modelZoo, type TrainedModel } from '@/features/ml/train/models';
import { fitPipeline, splitIndices, usableRows } from '@/features/ml/train/pipeline';
import type { Cell, ColumnProfile } from '@/features/ml/data/types';
import type {
  MetricMap,
  ModelKey,
  ModelResult,
  TrainConfig,
  TrainSummary,
} from '@/features/ml/train/types';

export interface TrainerCallbacks {
  onModelStart(key: ModelKey, index: number, total: number): void;
  onModelResult(result: ModelResult): void;
  isCancelled(): boolean;
}

/** Everything kept in worker memory after a run, for insights and what-if. */
export interface TrainArtifacts {
  models: Map<ModelKey, TrainedModel>;
  pipeline: ReturnType<typeof fitPipeline>;
  testX: number[][];
  testY: number[];
  /** Original row index of each test position — segment slicing needs it. */
  testIndices: number[];
  classes: string[];
  isClassification: boolean;
  seed: number;
}

export interface TrainOutcome {
  summary: TrainSummary;
  artifacts: TrainArtifacts;
}

const LATENCY_SAMPLE = 200;
const TRAINABLE_TYPES = new Set(['numeric', 'categorical', 'boolean']);

/** Lets queued worker messages (e.g. cancellation) run between models. */
export function yieldToQueue(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** The task, feature set and seeded train/test split — deterministic per config. */
export interface PreparedData {
  task: NonNullable<ReturnType<typeof detectTask>>;
  isClassification: boolean;
  classes: string[];
  featureColumns: string[];
  skippedColumns: string[];
  train: number[];
  test: number[];
  /** Stratification labels aligned with `train` (null for regression). */
  trainLabels: (string | null)[] | null;
  encode(i: number): number;
}

/**
 * Everything up to the split, shared by training and hyperparameter search so
 * both see the exact same rows (the search never touches the test indices).
 */
export function prepareData(
  columns: Map<string, Cell[]>,
  profiles: ColumnProfile[],
  config: TrainConfig,
): PreparedData {
  const targetProfile = profiles.find((p) => p.name === config.target);
  const targetValues = columns.get(config.target);
  if (!targetProfile || !targetValues) throw new Error('target-not-found');
  const task = detectTask(targetProfile, targetValues);
  if (!task) throw new Error('task-undetectable');
  const isClassification = task.type !== 'regression';

  const featureColumns: string[] = [];
  const skippedColumns: string[] = [];
  for (const name of config.features) {
    if (name === config.target) continue;
    const profile = profiles.find((p) => p.name === name);
    if (!profile) continue;
    if (TRAINABLE_TYPES.has(profile.type)) featureColumns.push(name);
    else skippedColumns.push(name);
  }
  if (featureColumns.length === 0) throw new Error('no-features');

  // Rows with a usable target; regression additionally needs a parseable number.
  let rows = usableRows(targetValues);
  if (!isClassification) {
    rows = rows.filter((i) => parseNumber((targetValues[i] as string).trim()) !== null);
  }

  const classes = task.classes ?? [];
  const classIndex = new Map(classes.map((label, index) => [label, index]));
  const labelOf = (i: number): number => classIndex.get((targetValues[i] as string).trim()) ?? -1;
  if (isClassification) rows = rows.filter((i) => labelOf(i) >= 0);

  const stratifyLabels = isClassification
    ? rows.map((i) => (isMissing(targetValues[i]) ? null : (targetValues[i] as string).trim()))
    : null;
  const { train, test } = splitIndices(rows, stratifyLabels, config.testRatio, config.seed);

  const trainLabels = isClassification
    ? train.map((i) => (isMissing(targetValues[i]) ? null : (targetValues[i] as string).trim()))
    : null;

  return {
    task,
    isClassification,
    classes,
    featureColumns,
    skippedColumns,
    train,
    test,
    trainLabels,
    encode: (i: number): number =>
      isClassification ? labelOf(i) : (parseNumber((targetValues[i] as string).trim()) as number),
  };
}

/** The run's metric block for one model on one evaluation set. */
export function scoreModel(
  model: TrainedModel,
  X: number[][],
  y: number[],
  isClassification: boolean,
  classCount: number,
): { metrics: MetricMap; primary: number } {
  const predictions = model.predict(X);
  const metrics: MetricMap = {};
  let primary: number;
  if (isClassification) {
    metrics.accuracy = accuracy(y, predictions);
    const prf = macroPrf(y, predictions, classCount);
    metrics.precision = prf.precision;
    metrics.recall = prf.recall;
    metrics.f1 = prf.f1;
    if (model.predictProba) {
      const probabilities = model.predictProba(X);
      metrics.logLoss = logLoss(y, probabilities);
      if (classCount === 2) {
        const auc = rocAuc(
          y,
          probabilities.map((p) => p[1]),
        );
        if (auc !== null) metrics.auc = auc;
      }
    }
    primary = metrics.accuracy;
  } else {
    metrics.rmse = rmse(y, predictions);
    metrics.mae = mae(y, predictions);
    metrics.r2 = r2(y, predictions);
    primary = metrics.rmse;
  }
  return { metrics, primary };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[index];
}

function measureLatency(model: TrainedModel, X: number[][]): { p50: number; p95: number } {
  const sample = X.slice(0, LATENCY_SAMPLE);
  const timings: number[] = [];
  for (const row of sample) {
    const start = performance.now();
    model.predict([row]);
    timings.push(performance.now() - start);
  }
  timings.sort((a, b) => a - b);
  return { p50: percentile(timings, 0.5), p95: percentile(timings, 0.95) };
}

export async function runTraining(
  columns: Map<string, Cell[]>,
  profiles: ColumnProfile[],
  config: TrainConfig,
  callbacks: TrainerCallbacks,
): Promise<TrainOutcome | null> {
  const startedAt = performance.now();
  const prepared = prepareData(columns, profiles, config);
  const { task, isClassification, classes, featureColumns, skippedColumns, train, test, encode } =
    prepared;

  const pipeline = fitPipeline(columns, profiles, featureColumns, train);
  const trainX = pipeline.transform(train);
  const testX = pipeline.transform(test);
  const trainY = train.map(encode);
  const testY = test.map(encode);

  const zoo = modelZoo(isClassification ? 'classification' : 'regression');
  const models = new Map<ModelKey, TrainedModel>();
  const context = {
    task: isClassification ? ('classification' as const) : ('regression' as const),
    classCount: classes.length,
    seed: config.seed,
  };

  for (let index = 0; index < zoo.length; index++) {
    if (callbacks.isCancelled()) return null;
    const def = zoo[index];
    callbacks.onModelStart(def.key, index, zoo.length);
    await yieldToQueue();
    if (callbacks.isCancelled()) return null;

    try {
      const trainStart = performance.now();
      const model = def.train(trainX, trainY, context);
      const trainMs = performance.now() - trainStart;
      models.set(def.key, model);
      const { metrics, primary } = scoreModel(
        model,
        testX,
        testY,
        isClassification,
        classes.length,
      );

      const latency = measureLatency(model, testX);
      callbacks.onModelResult({
        key: def.key,
        ok: true,
        metrics,
        primary,
        trainMs,
        inferP50Ms: latency.p50,
        inferP95Ms: latency.p95,
      });
    } catch (error) {
      callbacks.onModelResult({
        key: def.key,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        metrics: {},
        primary: Number.NaN,
        trainMs: 0,
        inferP50Ms: 0,
        inferP95Ms: 0,
      });
    }
    await yieldToQueue();
  }

  return {
    summary: {
      task,
      taskType: task.type,
      seed: config.seed,
      trainRows: train.length,
      testRows: test.length,
      featureCount: pipeline.featureNames.length,
      featureColumns,
      skippedColumns,
      totalMs: performance.now() - startedAt,
    },
    artifacts: {
      models,
      pipeline,
      testX,
      testY,
      testIndices: test,
      classes,
      isClassification,
      seed: config.seed,
    },
  };
}

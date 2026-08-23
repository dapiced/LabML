import { isMissing, parseNumber } from '@/features/ml/data/infer';
import { detectTask } from '@/features/ml/data/suggest';
import { accuracy, logLoss, macroPrf, mae, r2, rmse, rocAuc } from '@/features/ml/train/metrics';
import { MODEL_TRAIN_CAPS, modelZoo, type TrainedModel } from '@/features/ml/train/models';
import { fitPipeline, splitIndices, usableRows } from '@/features/ml/train/pipeline';
import { mulberry32, nestedSampleOrder, shuffleInPlace } from '@/features/ml/train/random';
import { leakScan } from '@/features/ml/train/leakage';
import {
  balancedWeights,
  majorityShare,
  IMBALANCE_THRESHOLD,
} from '@/features/ml/train/class-weight';
import { buildEnsemble, planEnsemble } from '@/features/ml/train/ensemble';
import { parseDate } from '@/features/ml/timeseries/series';
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
/**
 * V25: past this many usable rows, train/test are drawn from a seeded
 * stratified sample of exactly this size — and the summary SAYS so
 * (sampledFrom), on the leaderboard and in the report. Never silent.
 */
export const GLOBAL_SAMPLE_CAP = 100_000;
/**
 * V35: fraction of the TRAIN split held out for model selection. The test
 * split is carved first, exactly as before V35 — every panel that reads the
 * test set (segments, thresholds, uncertainty, batch compare) sees the same
 * rows it always did. Selection then happens on validation, so the crowned
 * number is no longer the maximum of nine draws on the reporting set.
 */
export const VALIDATION_RATIO = 0.2;
/**
 * V35: below this many usable rows a third split starves training and the
 * validation scores would be noise — so the lab refuses the third split by
 * name and ranks on test, as before V35.
 */
export const MIN_ROWS_FOR_VALIDATION = 60;
// 'text' joined the list in V24: free-text columns now enter the pipeline as
// TF-IDF blocks instead of being skipped. Dates and ids stay out.
const TRAINABLE_TYPES = new Set(['numeric', 'categorical', 'boolean', 'text']);

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
  /**
   * V35: rows held out for model selection — carved from the train side, so
   * `test` is identical to what the same config produced before V35. Empty
   * when the dataset is too small for a third split (refused by name).
   */
  validation: number[];
  test: number[];
  /** Stratification labels aligned with `train` (null for regression). */
  trainLabels: (string | null)[] | null;
  /** Usable rows before the announced global sample, when it engaged (V25). */
  sampledFrom?: number;
  /** V35: the announced non-random split that was applied, if any. */
  splitInfo?: { mode: 'chronological' | 'group'; column: string; dropped?: number };
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

  let stratifyLabels = isClassification
    ? rows.map((i) => (isMissing(targetValues[i]) ? null : (targetValues[i] as string).trim()))
    : null;

  // V25: the announced global cap. Beyond it, keep a seeded stratified sample
  // of exactly GLOBAL_SAMPLE_CAP rows and record where it came from — the UI
  // announces the sample; it is never applied silently.
  let sampledFrom: number | undefined;
  if (rows.length > GLOBAL_SAMPLE_CAP) {
    sampledFrom = rows.length;
    const order = nestedSampleOrder(rows.length, stratifyLabels, config.seed);
    const keep = order.slice(0, GLOBAL_SAMPLE_CAP).sort((a, b) => a - b);
    rows = keep.map((position) => rows[position]);
    if (stratifyLabels) {
      const labels = stratifyLabels;
      stratifyLabels = keep.map((position) => labels[position]);
    }
  }

  // V35: assign rows to splits. Random (stratified) is the default; a
  // chronological or group split is applied only when the config names one —
  // and the summary announces it, like every other decision here.
  let train: number[];
  let test: number[];
  let validation: number[] = [];
  let splitInfo: PreparedData['splitInfo'];
  const wantValidation = rows.length >= MIN_ROWS_FOR_VALIDATION;

  if (config.split) {
    const assigned = splitNonRandom(rows, columns, config, wantValidation);
    train = assigned.train;
    validation = assigned.validation;
    test = assigned.test;
    splitInfo = assigned.info;
  } else {
    ({ train, test } = splitIndices(rows, stratifyLabels, config.testRatio, config.seed));
    if (wantValidation) {
      // Carved from the TRAIN side with a derived seed: the test indices stay
      // byte-identical to what this config produced before V35.
      const labels = stratifyLabels
        ? train.map((i) => (isMissing(targetValues[i]) ? null : (targetValues[i] as string).trim()))
        : null;
      const second = splitIndices(train, labels, VALIDATION_RATIO, config.seed + 1);
      train = second.train;
      validation = second.test;
    }
  }

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
    validation,
    test,
    trainLabels,
    ...(sampledFrom !== undefined && { sampledFrom }),
    ...(splitInfo !== undefined && { splitInfo }),
    encode: (i: number): number =>
      isClassification ? labelOf(i) : (parseNumber((targetValues[i] as string).trim()) as number),
  };
}

/**
 * V35: the two announced non-random splits.
 *
 * Chronological — rows ordered by the named date column; the oldest block
 * trains, the middle one validates, the newest one tests. A random split on
 * dated data puts the future in training: the model looks excellent and
 * collapses in production. Rows without a parseable date cannot be placed in
 * time and are dropped, counted, and announced.
 *
 * Group — every row sharing the named column's value lands on one side only:
 * the same customer in both train and test is the same leak. Groups are
 * shuffled with the run's seed and dealt to test, then validation, until each
 * reaches its share. Rows with a missing group value are their own group.
 */
function splitNonRandom(
  rows: number[],
  columns: Map<string, Cell[]>,
  config: TrainConfig,
  wantValidation: boolean,
): {
  train: number[];
  validation: number[];
  test: number[];
  info: NonNullable<PreparedData['splitInfo']>;
} {
  const split = config.split!;
  const values = columns.get(split.column);
  if (!values) throw new Error('split-column-not-found');

  if (split.mode === 'chronological') {
    const dated: { row: number; at: number }[] = [];
    let dropped = 0;
    for (const row of rows) {
      const raw = values[row];
      const at = isMissing(raw) ? null : parseDate((raw as string).trim());
      if (at === null) dropped += 1;
      else dated.push({ row, at });
    }
    if (dated.length < 10) throw new Error('split-column-not-dated');
    // Stable order: ties fall back to row index so the split is deterministic.
    dated.sort((a, b) => a.at - b.at || a.row - b.row);
    const ordered = dated.map((d) => d.row);
    const testCount = Math.max(1, Math.round(ordered.length * config.testRatio));
    const rest = ordered.length - testCount;
    const valCount = wantValidation ? Math.max(1, Math.round(rest * VALIDATION_RATIO)) : 0;
    const train = ordered.slice(0, rest - valCount);
    const validation = ordered.slice(rest - valCount, rest);
    const test = ordered.slice(rest);
    return {
      train: [...train].sort((a, b) => a - b),
      validation: [...validation].sort((a, b) => a - b),
      test: [...test].sort((a, b) => a - b),
      info: { mode: 'chronological', column: split.column, ...(dropped > 0 && { dropped }) },
    };
  }

  // Group mode. Missing values become singleton groups — a row that belongs
  // to nobody cannot leak across the boundary.
  const groups = new Map<string, number[]>();
  let singleton = 0;
  for (const row of rows) {
    const raw = values[row];
    const key = isMissing(raw) ? `\u2205#${singleton++}` : (raw as string).trim();
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }
  if (groups.size < 3) throw new Error('split-column-not-groupable');
  const keys = [...groups.keys()].sort();
  shuffleInPlace(keys, mulberry32(config.seed));

  const testTarget = Math.max(1, Math.round(rows.length * config.testRatio));
  const valTarget = wantValidation
    ? Math.max(1, Math.round((rows.length - testTarget) * VALIDATION_RATIO))
    : 0;
  const train: number[] = [];
  const validation: number[] = [];
  const test: number[] = [];
  for (const key of keys) {
    const bucket = groups.get(key)!;
    if (test.length < testTarget) {
      for (const row of bucket) test.push(row);
    } else if (validation.length < valTarget) {
      for (const row of bucket) validation.push(row);
    } else {
      for (const row of bucket) train.push(row);
    }
  }
  if (train.length === 0 || test.length === 0) throw new Error('split-column-not-groupable');
  train.sort((a, b) => a - b);
  validation.sort((a, b) => a - b);
  test.sort((a, b) => a - b);
  return { train, validation, test, info: { mode: 'group', column: split.column } };
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
  const {
    task,
    isClassification,
    classes,
    featureColumns,
    skippedColumns,
    train,
    validation,
    test,
    encode,
  } = prepared;

  const pipeline = fitPipeline(columns, profiles, featureColumns, train);
  const trainX = pipeline.transform(train);
  const testX = pipeline.transform(test);
  const trainY = train.map(encode);
  const testY = test.map(encode);
  const valX = validation.length > 0 ? pipeline.transform(validation) : null;
  const valY = validation.length > 0 ? validation.map(encode) : null;

  // V35: the predictive leak scan — a lone column reading the target at 99%
  // is a warning, not a victory. Fitted on train, scored on validation, so
  // the detector cannot leak either; refused (empty) when validation is.
  const leakWarnings = leakScan(
    columns,
    profiles,
    featureColumns,
    train,
    validation,
    encode,
    isClassification,
  );

  const zoo = modelZoo(isClassification ? 'classification' : 'regression');
  const models = new Map<ModelKey, TrainedModel>();
  // Kept so the ensemble can pick its members by the shared ranking rule.
  const emitted = new Map<ModelKey, ModelResult>();

  // V25: one seeded order shared by every capped family — family K trains on
  // the first K positions, so smaller caps are subsets of larger ones (nested)
  // and every leaderboard row is scored on the same untouched test set.
  let sampleOrder: number[] | null = null;
  const cappedTrainPositions = (cap: number): number[] => {
    sampleOrder ??= nestedSampleOrder(train.length, prepared.trainLabels, config.seed);
    return sampleOrder.slice(0, cap).sort((a, b) => a - b);
  };

  // V36: class weights, only when asked for and only on classification.
  // Off by default — on a balanced target weighting changes nothing.
  const weights =
    config.classWeighting === 'balanced' && isClassification
      ? balancedWeights(trainY, classes.length)
      : undefined;

  const context = {
    task: isClassification ? ('classification' as const) : ('regression' as const),
    classCount: classes.length,
    seed: config.seed,
    ...(weights !== undefined && { classWeights: weights }),
  };

  for (let index = 0; index < zoo.length; index++) {
    if (callbacks.isCancelled()) return null;
    const def = zoo[index];
    callbacks.onModelStart(def.key, index, zoo.length);
    await yieldToQueue();
    if (callbacks.isCancelled()) return null;

    try {
      const cap = MODEL_TRAIN_CAPS[def.key];
      let fitX = trainX;
      let fitY = trainY;
      if (cap !== undefined && train.length > cap) {
        const keep = cappedTrainPositions(cap);
        fitX = keep.map((position) => trainX[position]);
        fitY = keep.map((position) => trainY[position]);
      }
      const trainStart = performance.now();
      const model = def.train(fitX, fitY, context);
      const trainMs = performance.now() - trainStart;
      models.set(def.key, model);
      const { metrics, primary } = scoreModel(
        model,
        testX,
        testY,
        isClassification,
        classes.length,
      );

      // V35: the same metric block on the selection split — the leaderboard
      // ranks on these so the crowned number is not the max of nine test draws.
      let validationScore: { metrics: MetricMap; primary: number } | null = null;
      if (valX !== null && valY !== null) {
        validationScore = scoreModel(model, valX, valY, isClassification, classes.length);
      }

      const latency = measureLatency(model, testX);
      const emittedResult: ModelResult = {
        key: def.key,
        ok: true,
        metrics,
        primary,
        trainMs,
        inferP50Ms: latency.p50,
        inferP95Ms: latency.p95,
        trainedRows: fitX.length,
        ...(validationScore !== null && {
          valMetrics: validationScore.metrics,
          valPrimary: validationScore.primary,
        }),
      };
      emitted.set(def.key, emittedResult);
      callbacks.onModelResult(emittedResult);
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

  // V36: the ensemble of the top families — free in compute, they are already
  // fitted. Refused by name when fewer than two real candidates exist.
  const zooResults = [...models.keys()].map((key) => emitted.get(key)!).filter(Boolean);
  const plan = planEnsemble(zooResults, task.type, models);
  if (plan !== null && !callbacks.isCancelled()) {
    try {
      const started = performance.now();
      const ensemble = buildEnsemble(plan, models, classes.length);
      const trainMs = performance.now() - started;
      models.set('ensemble', ensemble);
      const { metrics, primary } = scoreModel(
        ensemble,
        testX,
        testY,
        isClassification,
        classes.length,
      );
      const validationScore =
        valX !== null && valY !== null
          ? scoreModel(ensemble, valX, valY, isClassification, classes.length)
          : null;
      const latency = measureLatency(ensemble, testX);
      callbacks.onModelResult({
        key: 'ensemble',
        ok: true,
        metrics,
        primary,
        trainMs,
        inferP50Ms: latency.p50,
        inferP95Ms: latency.p95,
        ...(validationScore !== null && {
          valMetrics: validationScore.metrics,
          valPrimary: validationScore.primary,
        }),
      });
    } catch {
      // An ensemble that cannot be built is simply absent — the zoo stands.
      models.delete('ensemble');
    }
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
      ...(prepared.sampledFrom !== undefined && { sampledFrom: prepared.sampledFrom }),
      ...(validation.length > 0 && { validationRows: validation.length }),
      ...(prepared.splitInfo !== undefined && { split: prepared.splitInfo }),
      ...(leakWarnings.length > 0 && { leakWarnings }),
      ...(isClassification && {
        majorityShare: majorityShare(trainY, classes.length),
        imbalanced: majorityShare(trainY, classes.length) >= IMBALANCE_THRESHOLD,
      }),
      ...(weights !== undefined && { classWeighting: 'balanced' as const }),
      ...(plan !== null && { ensemble: plan }),
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

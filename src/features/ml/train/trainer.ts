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

const LATENCY_SAMPLE = 200;
const TRAINABLE_TYPES = new Set(['numeric', 'categorical', 'boolean']);

/** Lets queued worker messages (e.g. cancellation) run between models. */
function yieldToQueue(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
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
): Promise<TrainSummary | null> {
  const startedAt = performance.now();
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

  const pipeline = fitPipeline(columns, profiles, featureColumns, train);
  const trainX = pipeline.transform(train);
  const testX = pipeline.transform(test);
  const encode = (i: number): number =>
    isClassification ? labelOf(i) : (parseNumber((targetValues[i] as string).trim()) as number);
  const trainY = train.map(encode);
  const testY = test.map(encode);

  const zoo = modelZoo(isClassification ? 'classification' : 'regression');
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
      const predictions = model.predict(testX);

      const metrics: MetricMap = {};
      let primary: number;
      if (isClassification) {
        metrics.accuracy = accuracy(testY, predictions);
        const prf = macroPrf(testY, predictions, classes.length);
        metrics.precision = prf.precision;
        metrics.recall = prf.recall;
        metrics.f1 = prf.f1;
        if (model.predictProba) {
          const probabilities = model.predictProba(testX);
          metrics.logLoss = logLoss(testY, probabilities);
          if (classes.length === 2) {
            const auc = rocAuc(
              testY,
              probabilities.map((p) => p[1]),
            );
            if (auc !== null) metrics.auc = auc;
          }
        }
        primary = metrics.accuracy;
      } else {
        metrics.rmse = rmse(testY, predictions);
        metrics.mae = mae(testY, predictions);
        metrics.r2 = r2(testY, predictions);
        primary = metrics.rmse;
      }

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
    task,
    taskType: task.type,
    seed: config.seed,
    trainRows: train.length,
    testRows: test.length,
    featureCount: pipeline.featureNames.length,
    featureColumns,
    skippedColumns,
    totalMs: performance.now() - startedAt,
  };
}

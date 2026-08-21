/**
 * V26 — the learning curve answers the budget question: "would more data
 * help this model, or is it time to work on features?" The model is retrained
 * on growing seeded fractions of the train split — the SAME nested prefixes
 * V25's announced caps use (same seed, same order), so a capped family's last
 * point is the leaderboard model's diet, and the curve says out loud whether
 * the cap costs accuracy. Every point is scored on the untouched full test
 * set with a V20 bootstrap interval; the verdict is the V20 paired test
 * applied to the last size step — decisive gain or it is a plateau.
 */
import { fitPipeline } from '@/features/ml/train/pipeline';
import { MODEL_TRAIN_CAPS, modelZoo } from '@/features/ml/train/models';
import { nestedSampleOrder } from '@/features/ml/train/random';
import { prepareData, yieldToQueue } from '@/features/ml/train/trainer';
import { analyzeUncertainty } from '@/features/ml/train/uncertainty';
import type { Cell, ColumnProfile } from '@/features/ml/data/types';
import type { ModelKey, TrainConfig } from '@/features/ml/train/types';

/** At most this many curve points; sizes grow geometrically up to the max. */
const MAX_POINTS = 6;
/** Geometric span of the ladder: the first point is max/SPAN. */
const SPAN = 16;

export interface CurvePoint {
  /** Training rows this point used (a nested seeded prefix). */
  rows: number;
  /** Primary metric (accuracy or RMSE) on the full test set. */
  metric: number;
  /** 95% bootstrap interval of the metric (seeded, V20 machinery). */
  lo: number;
  hi: number;
  trainMs: number;
}

export type CurveVerdictKind = 'climbing' | 'plateau';

export interface CurveVerdict {
  kind: CurveVerdictKind;
  /** Oriented gain of the last size step (positive = bigger sample better). */
  gain: number;
  /** 95% paired bootstrap interval of that gain. */
  lo: number;
  hi: number;
  /** Share of paired resamples where the bigger sample wins. */
  winShare: number;
}

export interface LearningCurveOutcome {
  model: ModelKey;
  isClassification: boolean;
  metricLabel: 'accuracy' | 'rmse';
  testRows: number;
  /** Train rows available after the split (and the V25 global sample). */
  trainRows: number;
  /** The family's announced cap, when it truncated the curve. */
  cappedAt?: number;
  points: CurvePoint[];
  verdict: CurveVerdict;
  totalMs: number;
}

/**
 * Geometric ladder of training sizes: up to MAX_POINTS values from max/SPAN
 * to max, each at least `floor` rows, deduplicated, always ending at max.
 */
export function curveSizes(maxRows: number, floor: number): number[] {
  const ratio = SPAN ** (1 / (MAX_POINTS - 1));
  const sizes: number[] = [];
  for (let i = 0; i < MAX_POINTS; i++) {
    const size = Math.round(maxRows / ratio ** (MAX_POINTS - 1 - i));
    if (size < floor || size > maxRows) continue;
    if (sizes[sizes.length - 1] !== size) sizes.push(size);
  }
  if (sizes[sizes.length - 1] !== maxRows) sizes.push(maxRows);
  return sizes;
}

/**
 * The last size step, judged by the V20 paired bootstrap: the two loss
 * vectors live on the same test rows, so resampling them together asks
 * "does the gain survive the test draw?" — decisive gain, or plateau.
 */
export function stepVerdict(
  lastLosses: number[],
  previousLosses: number[],
  isClassification: boolean,
  seed: number,
): CurveVerdict {
  const analysis = analyzeUncertainty(
    [
      { model: 'mlp', values: lastLosses },
      { model: 'baseline', values: previousLosses },
    ],
    isClassification,
    seed,
  );
  // Tiny test sets get no interval theater (V20 rule): call it a plateau.
  if (!analysis) return { kind: 'plateau', gain: 0, lo: 0, hi: 0, winShare: 0.5 };
  const last = analysis.intervals.find((i) => i.model === 'mlp')!;
  const previous = analysis.intervals.find((i) => i.model === 'baseline')!;
  const gain = isClassification ? last.point - previous.point : previous.point - last.point;
  if (analysis.verdict && analysis.verdict.winner === 'mlp') {
    const { lo, hi, winShare, decisive } = analysis.verdict;
    const orientedLo = isClassification ? lo : -hi;
    const orientedHi = isClassification ? hi : -lo;
    return {
      kind: decisive ? 'climbing' : 'plateau',
      gain,
      lo: orientedLo,
      hi: orientedHi,
      winShare,
    };
  }
  // The bigger sample did not even win on the point metric.
  return { kind: 'plateau', gain, lo: 0, hi: 0, winShare: 0 };
}

export interface CurveCallbacks {
  onProgress(done: number, total: number): void;
  isCancelled(): boolean;
}

export async function runLearningCurve(
  columns: Map<string, Cell[]>,
  profiles: ColumnProfile[],
  config: TrainConfig,
  modelKey: ModelKey,
  callbacks: CurveCallbacks,
): Promise<LearningCurveOutcome | null> {
  // The baseline ignores its inputs — its curve is a flat line by definition.
  if (modelKey === 'baseline') return null;
  const startedAt = performance.now();
  const prepared = prepareData(columns, profiles, config);
  const { isClassification, classes, featureColumns, train, test, encode } = prepared;
  const def = modelZoo(isClassification ? 'classification' : 'regression').find(
    (d) => d.key === modelKey,
  );
  if (!def) return null;

  const cap = MODEL_TRAIN_CAPS[modelKey];
  const maxRows = cap !== undefined && cap < train.length ? cap : train.length;
  const floor = Math.max(16, classes.length * 4);
  const sizes = curveSizes(maxRows, floor);
  // One point is not a curve — tiny datasets get a named refusal, not noise.
  if (sizes.length < 2) return null;

  const context = {
    task: isClassification ? ('classification' as const) : ('regression' as const),
    classCount: classes.length,
    seed: config.seed,
  };
  // Same order as the trainer's announced caps: prefixes nest, and the cap
  // point trains on exactly the rows the leaderboard model saw.
  const order = nestedSampleOrder(train.length, prepared.trainLabels, config.seed);
  const testY = test.map(encode);

  const points: CurvePoint[] = [];
  const lossesPerPoint: number[][] = [];
  for (let index = 0; index < sizes.length; index++) {
    if (callbacks.isCancelled()) return null;
    const size = sizes[index];
    const positions = order.slice(0, size).sort((a, b) => a - b);
    const rows = positions.map((p) => train[p]);
    // The pipeline refits on each prefix: at N rows, every fitted parameter
    // (imputation, encoding, IDF, scaling) comes from those N rows only.
    const pipeline = fitPipeline(columns, profiles, featureColumns, rows);
    const trainX = pipeline.transform(rows);
    const trainY = rows.map(encode);
    const testX = pipeline.transform(test);
    const trainStart = performance.now();
    const model = def.train(trainX, trainY, context);
    const trainMs = performance.now() - trainStart;
    const predictions = model.predict(testX);
    const losses = isClassification
      ? predictions.map((p, i) => (p === testY[i] ? 1 : 0))
      : predictions.map((p, i) => (p - testY[i]) ** 2);
    lossesPerPoint.push(losses);
    const interval = analyzeUncertainty(
      [{ model: modelKey, values: losses }],
      isClassification,
      config.seed,
    )?.intervals[0];
    const mean = losses.reduce((a, v) => a + v, 0) / losses.length;
    const metric = isClassification ? mean : Math.sqrt(mean);
    points.push({
      rows: size,
      metric: interval?.point ?? metric,
      lo: interval?.lo ?? metric,
      hi: interval?.hi ?? metric,
      trainMs,
    });
    callbacks.onProgress(index + 1, sizes.length);
    await yieldToQueue();
  }

  const verdict = stepVerdict(
    lossesPerPoint[lossesPerPoint.length - 1],
    lossesPerPoint[lossesPerPoint.length - 2],
    isClassification,
    config.seed,
  );

  return {
    model: modelKey,
    isClassification,
    metricLabel: isClassification ? 'accuracy' : 'rmse',
    testRows: test.length,
    trainRows: train.length,
    ...(cap !== undefined && cap < train.length && { cappedAt: cap }),
    points,
    verdict,
    totalMs: performance.now() - startedAt,
  };
}

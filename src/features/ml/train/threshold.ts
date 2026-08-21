/**
 * Imbalance tools for binary classification — all computed on the held-out
 * test set's (probability, label) pairs, all deterministic:
 *  - precision-recall curve with Average Precision (step interpolation);
 *  - metrics at ANY decision threshold (a probability is not a decision);
 *  - the cost-optimal threshold for a user-supplied FP/FN cost matrix;
 *  - a calibration (reliability) curve with the Brier score.
 */

export interface PrPoint {
  recall: number;
  precision: number;
  threshold: number;
}

export interface PrCurve {
  /** Display points, recall-ascending, capped. */
  points: PrPoint[];
  /** Average Precision: sum of (R_n − R_{n−1}) · P_n over the full curve. */
  averagePrecision: number;
  /** Share of positives — the precision of a random classifier. */
  positiveRate: number;
}

export interface ThresholdMetrics {
  threshold: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number;
  recall: number;
  f1: number;
  accuracy: number;
  /** fp·costFp + fn·costFn for the costs given. */
  cost: number;
}

export interface CalibrationBin {
  meanPredicted: number;
  observedRate: number;
  count: number;
}

export interface CalibrationCurve {
  bins: CalibrationBin[];
  /** Mean squared gap between probability and outcome — lower is better. */
  brier: number;
}

const MAX_PR_POINTS = 100;

/** Pairs sorted by probability, descending; ties keep positive-first order out. */
function sortedPairs(y: number[], p: number[]): { p: number; y: number }[] {
  return y.map((label, i) => ({ p: p[i], y: label })).sort((a, b) => b.p - a.p || a.y - b.y);
}

export function prCurve(y: number[], p: number[]): PrCurve | null {
  const positives = y.reduce((a, v) => a + v, 0);
  if (positives === 0 || positives === y.length) return null;

  const pairs = sortedPairs(y, p);
  const raw: PrPoint[] = [];
  let tp = 0;
  let fp = 0;
  let averagePrecision = 0;
  let lastRecall = 0;
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i].y === 1) tp += 1;
    else fp += 1;
    // Emit one point per distinct threshold (after absorbing ties).
    if (i + 1 < pairs.length && pairs[i + 1].p === pairs[i].p) continue;
    const recall = tp / positives;
    const precision = tp / (tp + fp);
    raw.push({ recall, precision, threshold: pairs[i].p });
    averagePrecision += (recall - lastRecall) * precision;
    lastRecall = recall;
  }

  const step = Math.max(1, Math.ceil(raw.length / MAX_PR_POINTS));
  const points = raw.filter((_, i) => i % step === 0 || i === raw.length - 1);
  return { points, averagePrecision, positiveRate: positives / y.length };
}

export function thresholdMetrics(
  y: number[],
  p: number[],
  threshold: number,
  costFp = 1,
  costFn = 1,
): ThresholdMetrics {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (let i = 0; i < y.length; i++) {
    const predicted = p[i] >= threshold ? 1 : 0;
    if (predicted === 1 && y[i] === 1) tp += 1;
    else if (predicted === 1) fp += 1;
    else if (y[i] === 1) fn += 1;
    else tn += 1;
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return {
    threshold,
    tp,
    fp,
    fn,
    tn,
    precision,
    recall,
    f1,
    accuracy: y.length > 0 ? (tp + tn) / y.length : 0,
    cost: fp * costFp + fn * costFn,
  };
}

/**
 * The threshold minimizing fp·costFp + fn·costFn over every distinct
 * probability (plus "predict nothing"). Ties break toward the HIGHER
 * threshold — the more conservative decision raises fewer alarms.
 */
export function bestThresholdByCost(
  y: number[],
  p: number[],
  costFp: number,
  costFn: number,
): ThresholdMetrics {
  const positives = y.reduce((a, v) => a + v, 0);
  const pairs = sortedPairs(y, p);

  // Sweep thresholds from high to low; start at "no positive predictions".
  let tp = 0;
  let fp = 0;
  let best = { threshold: Number.POSITIVE_INFINITY, cost: positives * costFn };
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i].y === 1) tp += 1;
    else fp += 1;
    if (i + 1 < pairs.length && pairs[i + 1].p === pairs[i].p) continue;
    const cost = fp * costFp + (positives - tp) * costFn;
    if (cost < best.cost) best = { threshold: pairs[i].p, cost };
  }
  // "Predict nothing" optimal → an unreachable cut, reported as threshold 1.
  const cut = Number.isFinite(best.threshold) ? best.threshold : 1.01;
  const metrics = thresholdMetrics(y, p, cut, costFp, costFn);
  return { ...metrics, threshold: Math.min(cut, 1) };
}

export function calibrationCurve(y: number[], p: number[], binCount = 10): CalibrationCurve {
  const sums = new Array<number>(binCount).fill(0);
  const hits = new Array<number>(binCount).fill(0);
  const counts = new Array<number>(binCount).fill(0);
  let brier = 0;
  for (let i = 0; i < y.length; i++) {
    const bin = Math.min(binCount - 1, Math.floor(p[i] * binCount));
    sums[bin] += p[i];
    hits[bin] += y[i];
    counts[bin] += 1;
    brier += (p[i] - y[i]) ** 2;
  }
  const bins: CalibrationBin[] = [];
  for (let b = 0; b < binCount; b++) {
    if (counts[b] === 0) continue;
    bins.push({
      meanPredicted: sums[b] / counts[b],
      observedRate: hits[b] / counts[b],
      count: counts[b],
    });
  }
  return { bins, brier: y.length > 0 ? brier / y.length : 0 };
}

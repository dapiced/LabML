/**
 * V57: split conformal prediction — an uncertainty on ONE prediction, with a
 * coverage that can be checked.
 *
 * The bootstrap intervals (`uncertainty.ts`) say how sure the lab is of a
 * metric. They say nothing about a given row. Conformal prediction answers
 * with a set instead of a point: « cat or lynx » rather than « cat », « 42 ± 6 »
 * rather than « 42 », built so that the truth falls inside about 1 − α of the
 * time.
 *
 * The recipe is short. On rows the model was not fitted on (the calibration
 * split), measure how wrong it is — the non-conformity score: `1 − p(true
 * class)` for a classifier, `|y − ŷ|` for a regressor. Take the quantile of
 * those scores at the finite-sample level ⌈(n+1)(1−α)⌉ / n. That threshold q̂
 * defines the answer for any new row: every class with `p ≥ 1 − q̂`, or the
 * interval `ŷ ± q̂`.
 *
 * What the guarantee is, and is not:
 *  - it is MARGINAL — on average over rows like the calibration ones, not for
 *    each class, each segment or each row;
 *  - it assumes the calibration rows and the new rows are exchangeable — a
 *    drifted batch breaks it, which is what the drift report is for;
 *  - a regression interval has the same width everywhere: this is the plain
 *    split method, not an adaptive one.
 *
 * The lab does not ask to be believed: the coverage is measured on the test
 * split, which neither fitted the model nor set q̂, and shown beside the
 * target.
 */

/** Coverage targets the panel offers, as miscoverage rates α. */
export const CONFORMAL_ALPHAS = [0.2, 0.1, 0.05] as const;
export const DEFAULT_ALPHA = 0.1;

/**
 * Calibration rows needed for the quantile to exist at level 1 − α: below it,
 * ⌈(n+1)(1−α)⌉ exceeds n and the honest threshold is « everything ».
 */
export function minCalibrationRows(alpha: number): number {
  return Math.ceil(1 / alpha) - 1;
}

/**
 * The ⌈(n+1)(1−α)⌉-th smallest score. Null when there are too few scores for
 * the level asked — the caller refuses by name rather than returning a
 * threshold that guarantees nothing.
 */
export function conformalQuantile(scores: readonly number[], alpha: number): number | null {
  const n = scores.length;
  if (!(alpha > 0 && alpha < 1) || n === 0) return null;
  // The tiny epsilon keeps (n+1)(1−α) from landing a float hair above an
  // integer: 10 × 0.9 must be rank 9, not 10.
  const rank = Math.ceil((n + 1) * (1 - alpha) - 1e-9);
  if (rank > n) return null;
  const sorted = [...scores].sort((a, b) => a - b);
  return sorted[rank - 1];
}

/** Non-conformity of a classifier on labelled rows: 1 − p(true class). */
export function classificationScores(proba: readonly number[][], labels: readonly number[]) {
  return labels.map((label, i) => 1 - (proba[i][label] ?? 0));
}

/** Non-conformity of a regressor on labelled rows: the absolute residual. */
export function regressionScores(predictions: readonly number[], targets: readonly number[]) {
  return targets.map((target, i) => Math.abs(target - predictions[i]));
}

/**
 * The prediction set of each row: every class whose probability reaches
 * 1 − q̂. A set can be empty (no class is plausible enough) or hold several
 * classes (the model cannot tell them apart at this level): both are answers.
 */
export function classificationSets(proba: readonly number[][], qHat: number): number[][] {
  // Same epsilon as the quantile: a class sitting exactly on the threshold is
  // in, whatever the last bit of 1 − q̂ says.
  const floor = 1 - qHat - 1e-12;
  return proba.map((row) => {
    const set: number[] = [];
    for (let k = 0; k < row.length; k++) if (row[k] >= floor) set.push(k);
    return set;
  });
}

export interface SetMetrics {
  rows: number;
  /** Share of rows whose true class is in its set — to read beside 1 − α. */
  coverage: number;
  meanSize: number;
  /** Share of rows by set size: index 0 is empty, 1 is a single class, … */
  sizeShares: number[];
}

export function evaluateSets(sets: readonly number[][], labels: readonly number[]): SetMetrics {
  const rows = labels.length;
  let covered = 0;
  let total = 0;
  const counts: number[] = [];
  for (let i = 0; i < rows; i++) {
    const set = sets[i];
    if (set.includes(labels[i])) covered += 1;
    total += set.length;
    counts[set.length] = (counts[set.length] ?? 0) + 1;
  }
  const sizeShares = Array.from({ length: counts.length }, (_, k) =>
    rows > 0 ? (counts[k] ?? 0) / rows : 0,
  );
  return {
    rows,
    coverage: rows > 0 ? covered / rows : Number.NaN,
    meanSize: rows > 0 ? total / rows : Number.NaN,
    sizeShares,
  };
}

export interface IntervalMetrics {
  rows: number;
  /** Share of rows whose target falls in ŷ ± q̂. */
  coverage: number;
  /** q̂ itself: every interval is this wide on each side. */
  halfWidth: number;
}

export function evaluateIntervals(
  predictions: readonly number[],
  targets: readonly number[],
  qHat: number,
): IntervalMetrics {
  const rows = targets.length;
  let covered = 0;
  for (let i = 0; i < rows; i++) {
    if (Math.abs(targets[i] - predictions[i]) <= qHat + 1e-12) covered += 1;
  }
  return { rows, coverage: rows > 0 ? covered / rows : Number.NaN, halfWidth: qHat };
}

/**
 * A 95 % Wilson interval for a share measured on `n` rows: how much the
 * measured coverage itself could move with another test draw.
 */
export function wilsonInterval(share: number, n: number): { lo: number; hi: number } {
  if (!(n > 0) || !Number.isFinite(share)) return { lo: Number.NaN, hi: Number.NaN };
  const z = 1.959963984540054;
  const denominator = 1 + (z * z) / n;
  const centre = (share + (z * z) / (2 * n)) / denominator;
  const margin = (z * Math.sqrt((share * (1 - share)) / n + (z * z) / (4 * n * n))) / denominator;
  return { lo: Math.max(0, centre - margin), hi: Math.min(1, centre + margin) };
}

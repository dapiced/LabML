/**
 * V35: the predictive leak scan.
 *
 * V6's `leakSuggestions` catches columns whose values MAP to the target (the
 * "alive vs survived" case) and near-perfect linear correlations. What it
 * misses is the merely *predictive* leak: `amount_refunded` does not map to
 * `fraud`, yet a one-column rule reads it at 99%. A lone column that predicts
 * the target almost alone is nearly always information from the future — it
 * must show as a warning, never as a victory.
 *
 * Method, deliberately boring: per column, fit the cheapest possible
 * one-column model on the TRAIN split (categorical: majority class / mean per
 * value; numeric: majority class / mean per quantile bin), then score it on
 * the held-out selection split. No leakage in the leak detector itself.
 */
import { isMissing, parseNumber } from '@/features/ml/data/infer';
import type { Cell, ColumnProfile } from '@/features/ml/data/types';

/** Score at or above which a lone column is reported as a suspected leak. */
export const LEAK_SCORE_THRESHOLD = 0.99;
/** Below this many evaluation rows a 99% reading is noise — the scan refuses. */
export const LEAK_MIN_EVAL_ROWS = 20;
const NUMERIC_BINS = 32;

export interface LeakWarning {
  column: string;
  /** Accuracy (classification) or R² (regression) of the one-column stump. */
  score: number;
}

export function leakScan(
  columns: Map<string, Cell[]>,
  profiles: ColumnProfile[],
  featureColumns: string[],
  trainIdx: number[],
  evalIdx: number[],
  encode: (row: number) => number,
  isClassification: boolean,
): LeakWarning[] {
  if (evalIdx.length < LEAK_MIN_EVAL_ROWS) return [];

  const warnings: LeakWarning[] = [];
  for (const name of featureColumns) {
    const profile = profiles.find((p) => p.name === name);
    const values = columns.get(name);
    if (!profile || !values) continue;

    const keyOf = keyFunction(profile, values, trainIdx);
    const score = isClassification
      ? stumpAccuracy(trainIdx, evalIdx, encode, keyOf)
      : stumpR2(trainIdx, evalIdx, encode, keyOf);
    if (score !== null && score >= LEAK_SCORE_THRESHOLD) {
      warnings.push({ column: name, score });
    }
  }
  return warnings.sort((a, b) => b.score - a.score);
}

/** Missing cells share one bucket; numeric columns use train quantile bins. */
function keyFunction(
  profile: ColumnProfile,
  values: Cell[],
  trainIdx: number[],
): (row: number) => string {
  if (profile.type !== 'numeric') {
    return (row) => (isMissing(values[row]) ? '∅' : (values[row] as string).trim());
  }
  const parsed: number[] = [];
  for (const row of trainIdx) {
    if (isMissing(values[row])) continue;
    const n = parseNumber((values[row] as string).trim());
    if (n !== null) parsed.push(n);
  }
  parsed.sort((a, b) => a - b);
  const cuts: number[] = [];
  for (let b = 1; b < NUMERIC_BINS; b++) {
    const at = Math.min(parsed.length - 1, Math.floor((b / NUMERIC_BINS) * parsed.length));
    if (parsed.length > 0) cuts.push(parsed[at]);
  }
  return (row) => {
    if (isMissing(values[row])) return '∅';
    const n = parseNumber((values[row] as string).trim());
    if (n === null) return '∅';
    let lo = 0;
    let hi = cuts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (n <= cuts[mid]) hi = mid;
      else lo = mid + 1;
    }
    return `b${lo}`;
  };
}

function stumpAccuracy(
  trainIdx: number[],
  evalIdx: number[],
  encode: (row: number) => number,
  keyOf: (row: number) => string,
): number | null {
  const perKey = new Map<string, Map<number, number>>();
  const global = new Map<number, number>();
  for (const row of trainIdx) {
    const key = keyOf(row);
    const label = encode(row);
    const bucket = perKey.get(key) ?? new Map<number, number>();
    bucket.set(label, (bucket.get(label) ?? 0) + 1);
    perKey.set(key, bucket);
    global.set(label, (global.get(label) ?? 0) + 1);
  }
  const majority = (counts: Map<number, number>): number => {
    let best = -1;
    let bestCount = -1;
    for (const [label, count] of counts) {
      if (count > bestCount || (count === bestCount && label < best)) {
        best = label;
        bestCount = count;
      }
    }
    return best;
  };
  const fallback = majority(global);
  let hits = 0;
  for (const row of evalIdx) {
    const bucket = perKey.get(keyOf(row));
    const predicted = bucket ? majority(bucket) : fallback;
    if (predicted === encode(row)) hits += 1;
  }
  return hits / evalIdx.length;
}

function stumpR2(
  trainIdx: number[],
  evalIdx: number[],
  encode: (row: number) => number,
  keyOf: (row: number) => string,
): number | null {
  const sums = new Map<string, { sum: number; count: number }>();
  let globalSum = 0;
  for (const row of trainIdx) {
    const key = keyOf(row);
    const y = encode(row);
    const entry = sums.get(key) ?? { sum: 0, count: 0 };
    entry.sum += y;
    entry.count += 1;
    sums.set(key, entry);
    globalSum += y;
  }
  const fallback = globalSum / trainIdx.length;

  let evalMean = 0;
  for (const row of evalIdx) evalMean += encode(row);
  evalMean /= evalIdx.length;

  let sse = 0;
  let sst = 0;
  for (const row of evalIdx) {
    const y = encode(row);
    const entry = sums.get(keyOf(row));
    const predicted = entry ? entry.sum / entry.count : fallback;
    sse += (y - predicted) ** 2;
    sst += (y - evalMean) ** 2;
  }
  if (sst === 0) return null;
  return 1 - sse / sst;
}

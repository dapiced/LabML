/**
 * Honest uncertainty — "0.82 on 178 test rows is not 0.82". The test set is
 * bootstrap-resampled (seeded, SHARED resamples across models so comparisons
 * are paired) and each model's primary metric gets a 95% percentile interval.
 * The winner-vs-baseline verdict says whether the gap survives resampling —
 * and what these intervals measure is the sensitivity to the test draw, not
 * training variance: that honest limit ships with the numbers.
 */
import { mulberry32 } from '@/features/ml/train/random';
import type { ModelKey } from '@/features/ml/train/types';

/** Below this many test rows an interval is theater — declined, said so. */
export const MIN_UNCERTAINTY_ROWS = 8;
const RESAMPLES = 1000;

/** Per-position losses: hit (1/0) for classification, squared error otherwise. */
export interface ModelLosses {
  model: ModelKey;
  values: number[];
}

export interface ModelInterval {
  model: ModelKey;
  /** Primary metric on the full test set. */
  point: number;
  lo: number;
  hi: number;
}

export interface PairedVerdict {
  winner: ModelKey;
  against: ModelKey;
  /** metric(winner) − metric(against) on the full test set. */
  delta: number;
  lo: number;
  hi: number;
  /** Share of resamples where the winner strictly beats `against`. */
  winShare: number;
  /** The 95% interval of the delta excludes zero in the favorable direction. */
  decisive: boolean;
}

export interface UncertaintyAnalysis {
  isClassification: boolean;
  metricLabel: 'accuracy' | 'rmse';
  testRows: number;
  resamples: number;
  seed: number;
  /** Best first, by point metric (deterministic tiebreak on the model key). */
  intervals: ModelInterval[];
  /** Winner vs baseline — null when the baseline is missing or IS the winner. */
  verdict: PairedVerdict | null;
}

function metricOf(sum: number, n: number, isClassification: boolean): number {
  return isClassification ? sum / n : Math.sqrt(sum / n);
}

function percentile(sorted: number[], p: number): number {
  const pos = (sorted.length - 1) * p;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1];
  return next === undefined ? sorted[base] : sorted[base] + rest * (next - sorted[base]);
}

export function analyzeUncertainty(
  entries: ModelLosses[],
  isClassification: boolean,
  seed: number,
): UncertaintyAnalysis | null {
  if (entries.length === 0) return null;
  const n = entries[0].values.length;
  if (n < MIN_UNCERTAINTY_ROWS) return null;

  const points = entries.map(({ model, values }) => ({
    model,
    point: metricOf(
      values.reduce((a, v) => a + v, 0),
      n,
      isClassification,
    ),
  }));

  // One shared index draw per resample keeps every model on the SAME rows —
  // that pairing is what makes the winner-vs-baseline delta honest.
  const rng = mulberry32(seed);
  const indices = new Int32Array(n);
  const perModel = new Map<ModelKey, number[]>(entries.map((e) => [e.model, []]));
  for (let b = 0; b < RESAMPLES; b++) {
    for (let i = 0; i < n; i++) indices[i] = Math.floor(rng() * n);
    for (const { model, values } of entries) {
      let sum = 0;
      for (let i = 0; i < n; i++) sum += values[indices[i]];
      perModel.get(model)!.push(metricOf(sum, n, isClassification));
    }
  }

  const intervals: ModelInterval[] = points
    .map(({ model, point }) => {
      const sorted = [...perModel.get(model)!].sort((a, b) => a - b);
      return { model, point, lo: percentile(sorted, 0.025), hi: percentile(sorted, 0.975) };
    })
    .sort((a, b) => {
      const primary = isClassification ? b.point - a.point : a.point - b.point;
      return primary !== 0 ? primary : a.model.localeCompare(b.model);
    });

  const winner = intervals[0].model;
  let verdict: PairedVerdict | null = null;
  const baseline = perModel.get('baseline');
  if (winner !== 'baseline' && baseline) {
    const winnerMetrics = perModel.get(winner)!;
    const deltas = winnerMetrics.map((m, b) => m - baseline[b]);
    let wins = 0;
    for (let b = 0; b < RESAMPLES; b++) {
      if (isClassification ? deltas[b] > 0 : deltas[b] < 0) wins += 1;
    }
    const sorted = [...deltas].sort((a, b) => a - b);
    const lo = percentile(sorted, 0.025);
    const hi = percentile(sorted, 0.975);
    verdict = {
      winner,
      against: 'baseline',
      delta: intervals[0].point - points.find((p) => p.model === 'baseline')!.point,
      lo,
      hi,
      winShare: wins / RESAMPLES,
      decisive: isClassification ? lo > 0 : hi < 0,
    };
  }

  return {
    isClassification,
    metricLabel: isClassification ? 'accuracy' : 'rmse',
    testRows: n,
    resamples: RESAMPLES,
    seed,
    intervals,
    verdict,
  };
}

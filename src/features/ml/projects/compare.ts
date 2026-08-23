/**
 * v21 — "did my cleaning help?": a typed side-by-side diff of two stored
 * runs. Metrics only compare when the runs share the target AND the task
 * family; otherwise the diff honestly limits itself to configuration. The
 * v20 intervals of each winner ride along — from two SEPARATE test draws,
 * so the cross-run verdict is indicative, never paired, and says so.
 */
import type { RunRecord } from '@/features/ml/projects/types';
import type { ModelInterval } from '@/features/ml/train/uncertainty';
import type { ModelKey } from '@/features/ml/train/types';
import { bestResult } from '@/features/ml/train/ranking';

export interface ModelDelta {
  key: ModelKey;
  a: number | null;
  b: number | null;
  /** b − a, when the model succeeded in both runs. */
  delta: number | null;
}

export interface RunComparison {
  isClassification: boolean;
  metricLabel: 'accuracy' | 'rmse';
  sameDataset: boolean;
  sameTarget: boolean;
  /** Metric deltas exist only when target and task family both match. */
  comparable: boolean;
  features: { added: string[]; removed: string[]; kept: string[] };
  /** Union of model keys, run B's ranking first — empty when not comparable. */
  models: ModelDelta[];
  best: {
    a: { key: ModelKey; primary: number };
    b: { key: ModelKey; primary: number };
    /** b − a on the primary metric. */
    delta: number;
    /** Oriented: higher accuracy, or lower RMSE. */
    improved: boolean;
  } | null;
  /** Each run's winner interval (v20) — null unless both runs carry one. */
  intervals: { a: ModelInterval; b: ModelInterval; overlap: boolean } | null;
}

function bestOf(record: RunRecord): { key: ModelKey; primary: number } | null {
  // V35: ranking lives in one place — a run with validation scores is ranked
  // on those, so the comparison crowns the same model the leaderboard did.
  // The reported figure stays the TEST metric: that is what runs compare on.
  const best = bestResult(record.results, record.taskType);
  return best === null ? null : { key: best.key, primary: best.primary };
}

export function compareRuns(a: RunRecord, b: RunRecord): RunComparison {
  const isClassification = a.taskType !== 'regression';
  const sameFamily = isClassification === (b.taskType !== 'regression');
  const sameTarget = a.target === b.target;
  const comparable = sameTarget && sameFamily;

  const aFeatures = new Set(a.summary.featureColumns);
  const bFeatures = new Set(b.summary.featureColumns);
  const features = {
    added: [...bFeatures].filter((f) => !aFeatures.has(f)).sort(),
    removed: [...aFeatures].filter((f) => !bFeatures.has(f)).sort(),
    kept: [...aFeatures].filter((f) => bFeatures.has(f)).sort(),
  };

  let models: ModelDelta[] = [];
  let best: RunComparison['best'] = null;
  let intervals: RunComparison['intervals'] = null;

  if (comparable) {
    const aPrimary = new Map(a.results.filter((r) => r.ok).map((r) => [r.key, r.primary]));
    const bPrimary = new Map(b.results.filter((r) => r.ok).map((r) => [r.key, r.primary]));
    const keys = [...new Set([...bPrimary.keys(), ...aPrimary.keys()])];
    const rank = (key: ModelKey) => {
      const v = bPrimary.get(key) ?? aPrimary.get(key)!;
      return isClassification ? -v : v;
    };
    keys.sort((x, y) => rank(x) - rank(y) || x.localeCompare(y));
    models = keys.map((key) => {
      const av = aPrimary.get(key) ?? null;
      const bv = bPrimary.get(key) ?? null;
      return { key, a: av, b: bv, delta: av !== null && bv !== null ? bv - av : null };
    });

    const bestA = bestOf(a);
    const bestB = bestOf(b);
    if (bestA && bestB) {
      const delta = bestB.primary - bestA.primary;
      best = {
        a: bestA,
        b: bestB,
        delta,
        improved: isClassification ? delta > 0 : delta < 0,
      };
    }

    const ia = a.artifacts?.uncertainty?.intervals[0];
    const ib = b.artifacts?.uncertainty?.intervals[0];
    if (ia && ib) {
      intervals = { a: ia, b: ib, overlap: ia.lo <= ib.hi && ib.lo <= ia.hi };
    }
  }

  return {
    isClassification,
    metricLabel: isClassification ? 'accuracy' : 'rmse',
    sameDataset: a.dataset.name === b.dataset.name,
    sameTarget,
    comparable,
    features,
    models,
    best,
    intervals,
  };
}

/**
 * V37: the parallel trainer — orchestration only, no maths.
 *
 * Measured before it was built (PLAN V37, 60 000 rows, 38 400 training rows):
 * the zoo takes ~10.4 s sequentially and four families carry 97% of it —
 * MLP 3.1 s, logistic 2.7 s, forest 2.5 s, gbdt 1.8 s — while baseline,
 * naive Bayes, tree and k-NN together cost about 0.2 s. Four roughly equal
 * heavy families is the shape parallelism actually helps: the wall time
 * floor is the slowest one, not the sum.
 *
 * Three rules the design follows:
 *
 * 1. **k-NN never leaves.** It is the only family with no `toJSON` — it keeps
 *    its training rows — and it is also the one that fits in 0 ms. It trains
 *    in the main worker with the other instant families.
 * 2. **Models come back as JSON, not as objects.** `predict` is a closure and
 *    structured clone drops functions, so each helper returns `toJSON()` and
 *    the caller rebuilds through the V22 path.
 * 3. **A failure is never fatal.** If workers cannot be created, a helper
 *    errors, or a family comes back unserialisable, that family falls back to
 *    the sequential trainer. Parallelism is an optimisation; it may not
 *    change which models a run produces.
 */
import type { ModelKey } from '@/features/ml/train/types';

/** Families that cost enough to be worth shipping to another core. */
export const HEAVY_FAMILIES: readonly ModelKey[] = ['mlp', 'logistic', 'forest', 'gbdt', 'linear'];

/**
 * Never more than this many helpers, whatever the machine reports: past the
 * number of heavy families the extra workers only cost memory, and leaving a
 * core for the UI thread is what keeps the page responsive while training.
 */
export const MAX_HELPERS = 4;

/** How many helpers to spawn for a given zoo, on this machine. */
export function helperCount(families: readonly ModelKey[], cores: number): number {
  const heavy = families.filter((key) => HEAVY_FAMILIES.includes(key)).length;
  if (heavy < 2) return 0; // one heavy family in parallel is just overhead
  return Math.max(0, Math.min(MAX_HELPERS, heavy, Math.max(1, cores - 1)));
}

/**
 * Splits families across helpers by measured cost, heaviest first, always to
 * the currently lightest helper. Greedy longest-processing-time — the classic
 * makespan heuristic, and the right one here: four buckets, known costs.
 */
export function planBatches(
  families: readonly ModelKey[],
  helpers: number,
  cost: (key: ModelKey) => number,
): ModelKey[][] {
  if (helpers <= 0) return [];
  const batches: ModelKey[][] = Array.from({ length: helpers }, () => []);
  const load = new Array<number>(helpers).fill(0);
  const ordered = [...families].sort((a, b) => cost(b) - cost(a) || a.localeCompare(b));
  for (const key of ordered) {
    let lightest = 0;
    for (let i = 1; i < helpers; i++) if (load[i] < load[lightest]) lightest = i;
    batches[lightest].push(key);
    load[lightest] += cost(key);
  }
  return batches.filter((batch) => batch.length > 0);
}

/**
 * Relative training cost per family, from the V37 measurement. Only the
 * ORDER and rough ratios matter — this feeds the makespan heuristic, not any
 * reported number, so it never has to be re-measured to stay correct.
 */
export const MEASURED_COST: Record<string, number> = {
  mlp: 31,
  logistic: 27,
  forest: 25,
  gbdt: 17,
  linear: 17,
  tree: 2,
  naiveBayes: 1,
  knn: 1,
  baseline: 1,
};

export function familyCost(key: ModelKey): number {
  return MEASURED_COST[key] ?? 1;
}

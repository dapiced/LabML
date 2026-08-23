/**
 * V36: class weighting — the item V16 descoped by name.
 *
 * On an imbalanced target, every family happily learns "always answer the
 * majority class": 99% accuracy and zero recall on the class you actually
 * care about. V16 shipped the threshold panel, which fixes the DECISION, and
 * deliberately left the training side open. This closes it.
 *
 * Two mechanisms, because the zoo is not uniform, and each is NAMED where it
 * is used rather than hidden behind one word:
 *
 * - `loss` — the per-row gradient is multiplied by the class's weight.
 *   Available where the loss is ours to weight: logistic regression and the
 *   hand-written gradient boosting. Nothing is duplicated or discarded.
 * - `resample` — the training rows are drawn, seeded, so every class reaches
 *   the same expected mass. Used for the ml-cart families (decision tree,
 *   random forest), whose implementation takes no sample weights. Rows are
 *   repeated, so the fit sees more rows than the split holds — the panel says
 *   so rather than letting the count look wrong.
 */
import { mulberry32 } from '@/features/ml/train/random';

export type WeightMode = 'none' | 'balanced';
export type WeightMechanism = 'loss' | 'resample';

/**
 * The standard "balanced" rule: w[c] = n / (k · count[c]), so every class
 * carries the same total mass and a class absent from the split gets 1
 * rather than an infinity that would poison the gradient.
 */
export function balancedWeights(y: number[], classCount: number): number[] {
  const counts = new Array<number>(classCount).fill(0);
  for (const label of y) if (label >= 0 && label < classCount) counts[label] += 1;
  return counts.map((count) => (count > 0 ? y.length / (classCount * count) : 1));
}

/**
 * How lopsided the target is: the largest class's share of the split. Used to
 * decide whether weighting is worth offering at all — on a balanced problem
 * it changes nothing and would only add a knob.
 */
export function majorityShare(y: number[], classCount: number): number {
  const counts = new Array<number>(classCount).fill(0);
  for (const label of y) if (label >= 0 && label < classCount) counts[label] += 1;
  return y.length === 0 ? 0 : Math.max(...counts) / y.length;
}

/** Above this majority share, the lab offers class weighting on the panel. */
export const IMBALANCE_THRESHOLD = 0.6;

/**
 * Seeded row order that balances the classes by repetition. Returns POSITIONS
 * into the given `y` (and therefore into the matching X).
 *
 * Every class is drawn up to the size of the LARGEST class — the minority is
 * upsampled, the majority is never trimmed. Balancing by downsampling the
 * common class would throw away real observations to fix a ratio, which is a
 * worse trade than repeating a few rare ones. Deterministic for a given seed.
 */
export function balancedResample(y: number[], classCount: number, seed: number): number[] {
  const buckets: number[][] = Array.from({ length: classCount }, () => []);
  for (let i = 0; i < y.length; i++) {
    const label = y[i];
    if (label >= 0 && label < classCount) buckets[label].push(i);
  }
  const present = buckets.filter((bucket) => bucket.length > 0);
  if (present.length < 2) return y.map((_, i) => i);

  const target = Math.max(...present.map((bucket) => bucket.length));
  const rng = mulberry32(seed);
  const out: number[] = [];
  for (const bucket of buckets) {
    if (bucket.length === 0) continue;
    for (let picked = 0; picked < target; picked++) {
      // Whole passes first, then a seeded draw for the remainder: a class that
      // already has enough rows keeps all of them exactly once.
      out.push(picked < bucket.length ? bucket[picked] : bucket[Math.floor(rng() * bucket.length)]);
    }
  }
  return out.sort((a, b) => a - b);
}

/** Which mechanism a family uses when weighting is on — named, per family. */
export const WEIGHT_MECHANISM: Record<string, WeightMechanism | undefined> = {
  logistic: 'loss',
  gbdt: 'loss',
  tree: 'resample',
  forest: 'resample',
};

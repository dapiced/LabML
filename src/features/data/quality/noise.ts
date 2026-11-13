/**
 * V62: what a PSI is worth depends on how many rows stand behind it.
 *
 * Over B bins, the PSI of two samples of the SAME population averages about
 * (B − 1) × (1/n + 1/n_ref): 0.11 for ten bins, 100 rows against 500. The
 * usual reading (0.1 moderate, 0.25 strong) therefore calls drift what is
 * only a small file. Measured in V61 on batches drawn from the very file the
 * reference came from: a « strong » alert on 78 % of 100-row batches of
 * titanic, 24 % on mpg, 8 % on fraud, and on nearly every 30-row batch.
 *
 * The ceiling is the value a PSI stays under, with a chosen probability, when
 * both sides are draws of the same shares at their real sizes. It is
 * simulated with a fixed seed and not approximated: the smoothing of empty
 * bins makes the PSI far heavier-tailed than a chi-square on small samples.
 *
 * V61 wrote it for the production check; V62 moved it here, unchanged, so the
 * Data Studio's drift report can use it without depending on the ML export.
 */
import { mulberry32 } from '@/features/ml/train/random';

/** Laplace-style smoothing so an empty bin never yields an infinite PSI. */
const EPSILON = 1e-4;

/** Draws of the no-drift situation behind each ceiling. */
const SIMULATIONS = 1000;
/** Past this size the noise is negligible; simulating more rows buys nothing. */
const SIMULATED_ROWS_CAP = 1000;
const CEILING_SEED = 6100;

/** PSI between two discrete distributions given as aligned probability arrays. */
export function psi(reference: readonly number[], current: readonly number[]): number {
  let total = 0;
  for (let i = 0; i < reference.length; i++) {
    const p = Math.max(reference[i], EPSILON);
    const q = Math.max(current[i] ?? 0, EPSILON);
    total += (q - p) * Math.log(q / p);
  }
  return total;
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return low === high ? sorted[low] : sorted[low] + (position - low) * (sorted[high] - sorted[low]);
}

/** Counts of `rows` draws over bins of the given shares, as shares. */
function drawShares(cumulative: readonly number[], rows: number, rng: () => number): number[] {
  const counts = new Array<number>(cumulative.length).fill(0);
  const last = cumulative.length - 1;
  for (let i = 0; i < rows; i++) {
    const u = rng();
    let bin = 0;
    while (bin < last && u > cumulative[bin]) bin += 1;
    counts[bin] += 1;
  }
  return counts.map((count) => count / rows);
}

/**
 * The PSI a batch of `rows` stays under, with probability `level`, when it is
 * drawn from the very population the reference of `refRows` was drawn from.
 * Both sides are redrawn: the reference is a sample too.
 */
export function noiseCeiling(
  shares: readonly number[],
  refRows: number,
  rows: number,
  level: number,
  seed = CEILING_SEED,
): number {
  const total = shares.reduce((a, b) => a + b, 0);
  if (!(total > 0) || rows < 1 || refRows < 1) return Number.POSITIVE_INFINITY;
  const cumulative: number[] = [];
  let running = 0;
  for (const share of shares) {
    running += share / total;
    cumulative.push(running);
  }
  const n = Math.min(Math.round(rows), SIMULATED_ROWS_CAP);
  const nRef = Math.min(Math.round(refRows), SIMULATED_ROWS_CAP);
  const rng = mulberry32(seed);
  const values: number[] = [];
  for (let s = 0; s < SIMULATIONS; s++) {
    values.push(psi(drawShares(cumulative, nRef, rng), drawShares(cumulative, n, rng)));
  }
  values.sort((a, b) => a - b);
  return quantile(values, level);
}

/**
 * The shares both sides are drawn from when nothing moved: the two samples
 * put together. Drawing from the reference's shares alone looked right and
 * was measured wrong (V62): a category the reference happened to lack has a
 * share of zero there, the simulation never produces it, and one stray
 * spelling in the new file was reported as a strong drift. On the Data
 * Studio's own demo, two halves of one file then « drifted » in 48 to 64 % of
 * reports. Under the hypothesis being tested the two files are one
 * population, and its best estimate is their pool.
 */
export function pooledShares(
  refShares: readonly number[],
  refCount: number,
  newShares: readonly number[],
  newCount: number,
): number[] {
  const total = refCount + newCount;
  if (!(total > 0)) return [...refShares];
  return refShares.map(
    (share, bin) => (share * refCount + (newShares[bin] ?? 0) * newCount) / total,
  );
}

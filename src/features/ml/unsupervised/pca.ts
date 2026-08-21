/**
 * Two-component PCA by power iteration with deflation — hand-written and
 * deterministic (seeded start vector), enough for a 2D projection with
 * explained-variance ratios. Input rows are centered here; the caller usually
 * feeds already-standardized pipeline features.
 */
import { mulberry32 } from '@/features/ml/train/random';

const POWER_ITERATIONS = 200;
const TOLERANCE = 1e-10;

export interface Pca2 {
  /** Row projections on the first two components. */
  points: [number, number][];
  /** Fraction of total variance carried by each component. */
  explained: [number, number];
}

function center(X: number[][]): { rows: number[][]; totalVariance: number } {
  const n = X.length;
  const d = X[0]?.length ?? 0;
  const mean = new Array<number>(d).fill(0);
  for (const row of X) for (let j = 0; j < d; j++) mean[j] += row[j];
  for (let j = 0; j < d; j++) mean[j] /= n || 1;
  const rows = X.map((row) => row.map((v, j) => v - mean[j]));
  let totalVariance = 0;
  for (const row of rows) for (const v of row) totalVariance += v * v;
  return { rows, totalVariance: totalVariance / (n || 1) };
}

/** X^T X v / n without materializing the covariance matrix. */
function covTimes(rows: number[][], v: number[]): number[] {
  const n = rows.length;
  const d = v.length;
  const result = new Array<number>(d).fill(0);
  for (const row of rows) {
    let dot = 0;
    for (let j = 0; j < d; j++) dot += row[j] * v[j];
    for (let j = 0; j < d; j++) result[j] += dot * row[j];
  }
  for (let j = 0; j < d; j++) result[j] /= n || 1;
  return result;
}

function normalize(v: number[]): number {
  const norm = Math.sqrt(v.reduce((acc, x) => acc + x * x, 0));
  if (norm > 0) for (let j = 0; j < v.length; j++) v[j] /= norm;
  return norm;
}

function powerComponent(rows: number[][], seed: number): { vector: number[]; value: number } {
  const d = rows[0]?.length ?? 0;
  const rng = mulberry32(seed);
  let v = Array.from({ length: d }, () => rng() - 0.5);
  normalize(v);
  let value = 0;
  for (let iteration = 0; iteration < POWER_ITERATIONS; iteration++) {
    const next = covTimes(rows, v);
    const norm = normalize(next);
    let delta = 0;
    for (let j = 0; j < d; j++) delta = Math.max(delta, Math.abs(next[j] - v[j]));
    v = next;
    value = norm;
    if (delta < TOLERANCE) break;
  }
  // Sign convention: largest-magnitude coordinate positive (deterministic).
  let argmax = 0;
  for (let j = 1; j < d; j++) if (Math.abs(v[j]) > Math.abs(v[argmax])) argmax = j;
  if (v[argmax] < 0) for (let j = 0; j < d; j++) v[j] = -v[j];
  return { vector: v, value };
}

export function pca2(X: number[][], seed: number): Pca2 {
  const { rows, totalVariance } = center(X);
  const d = rows[0]?.length ?? 0;
  if (d === 0 || rows.length === 0 || totalVariance === 0) {
    return { points: X.map(() => [0, 0]), explained: [0, 0] };
  }

  const first = powerComponent(rows, seed);
  // Deflate: remove the first component from every row.
  const deflated = rows.map((row) => {
    let dot = 0;
    for (let j = 0; j < d; j++) dot += row[j] * first.vector[j];
    return row.map((v, j) => v - dot * first.vector[j]);
  });
  const second = d > 1 ? powerComponent(deflated, seed + 1) : { vector: first.vector, value: 0 };

  const points: [number, number][] = rows.map((row) => {
    let x = 0;
    let y = 0;
    for (let j = 0; j < d; j++) {
      x += row[j] * first.vector[j];
      y += row[j] * second.vector[j];
    }
    return [x, y];
  });

  return {
    points,
    explained: [first.value / totalVariance, second.value / totalVariance],
  };
}

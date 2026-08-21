/**
 * Hand-written, fully seeded k-means: k-means++ initialization, Lloyd
 * iterations, deterministic tie-breaking, empty clusters repaired with the
 * farthest point. Model choice by (sampled) silhouette over k = 2…MAX_K.
 */
import { mulberry32, shuffleInPlace } from '@/features/ml/train/random';

export const MIN_K = 2;
export const MAX_K = 5;
const MAX_ITERATIONS = 100;
/** Silhouette is O(n²): computed on a seeded sample beyond this size. */
const SILHOUETTE_SAMPLE = 300;

export interface KmeansResult {
  k: number;
  assignments: number[];
  centroids: number[][];
  inertia: number;
}

function squaredDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let j = 0; j < a.length; j++) sum += (a[j] - b[j]) ** 2;
  return sum;
}

function nearestCentroid(row: number[], centroids: number[][]): { index: number; d: number } {
  let index = 0;
  let best = Infinity;
  for (let c = 0; c < centroids.length; c++) {
    const d = squaredDistance(row, centroids[c]);
    if (d < best) {
      best = d;
      index = c;
    }
  }
  return { index, d: best };
}

/** k-means++ seeding: each next center drawn ∝ squared distance to the closest chosen one. */
function initCentroids(X: number[][], k: number, rng: () => number): number[][] {
  const centroids: number[][] = [[...X[Math.floor(rng() * X.length)]]];
  const distances = X.map((row) => squaredDistance(row, centroids[0]));
  while (centroids.length < k) {
    const total = distances.reduce((a, v) => a + v, 0);
    let threshold = rng() * total;
    let chosen = 0;
    for (let i = 0; i < X.length; i++) {
      threshold -= distances[i];
      if (threshold <= 0) {
        chosen = i;
        break;
      }
    }
    const centroid = [...X[chosen]];
    centroids.push(centroid);
    for (let i = 0; i < X.length; i++) {
      distances[i] = Math.min(distances[i], squaredDistance(X[i], centroid));
    }
  }
  return centroids;
}

export function kmeans(X: number[][], k: number, seed: number): KmeansResult {
  const rng = mulberry32(seed);
  const d = X[0]?.length ?? 0;
  const centroids = initCentroids(X, k, rng);
  const assignments = new Array<number>(X.length).fill(0);

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    let changed = false;
    for (let i = 0; i < X.length; i++) {
      const { index } = nearestCentroid(X[i], centroids);
      if (index !== assignments[i]) {
        assignments[i] = index;
        changed = true;
      }
    }

    const sums = Array.from({ length: k }, () => new Array<number>(d).fill(0));
    const counts = new Array<number>(k).fill(0);
    for (let i = 0; i < X.length; i++) {
      counts[assignments[i]] += 1;
      const sum = sums[assignments[i]];
      for (let j = 0; j < d; j++) sum[j] += X[i][j];
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] === 0) {
        // Repair an empty cluster with the point farthest from its centroid.
        let farthest = 0;
        let best = -1;
        for (let i = 0; i < X.length; i++) {
          const dist = squaredDistance(X[i], centroids[assignments[i]]);
          if (dist > best) {
            best = dist;
            farthest = i;
          }
        }
        centroids[c] = [...X[farthest]];
        assignments[farthest] = c;
        changed = true;
        continue;
      }
      centroids[c] = sums[c].map((v) => v / counts[c]);
    }
    if (!changed && iteration > 0) break;
  }

  let inertia = 0;
  for (let i = 0; i < X.length; i++) {
    inertia += squaredDistance(X[i], centroids[assignments[i]]);
  }
  return { k, assignments, centroids, inertia };
}

/** Mean silhouette over a seeded sample (exact when n ≤ sample size). */
export function silhouetteScore(
  X: number[][],
  assignments: number[],
  k: number,
  seed: number,
): number {
  const indices =
    X.length <= SILHOUETTE_SAMPLE
      ? X.map((_, i) => i)
      : shuffleInPlace(
          X.map((_, i) => i),
          mulberry32(seed),
        ).slice(0, SILHOUETTE_SAMPLE);

  let total = 0;
  let counted = 0;
  for (const i of indices) {
    const own = assignments[i];
    const sums = new Array<number>(k).fill(0);
    const counts = new Array<number>(k).fill(0);
    for (let other = 0; other < X.length; other++) {
      if (other === i) continue;
      const c = assignments[other];
      sums[c] += Math.sqrt(squaredDistance(X[i], X[other]));
      counts[c] += 1;
    }
    if (counts[own] === 0) continue; // singleton cluster: silhouette undefined
    const a = sums[own] / counts[own];
    let b = Infinity;
    for (let c = 0; c < k; c++) {
      if (c === own || counts[c] === 0) continue;
      b = Math.min(b, sums[c] / counts[c]);
    }
    if (!Number.isFinite(b)) continue;
    total += (b - a) / Math.max(a, b);
    counted += 1;
  }
  return counted > 0 ? total / counted : 0;
}

export interface ExploredKmeans extends KmeansResult {
  silhouette: number;
  tried: { k: number; silhouette: number }[];
}

/** Runs k = MIN_K…MAX_K and keeps the best silhouette (deterministic). */
export function chooseKmeans(X: number[][], seed: number): ExploredKmeans {
  const tried: { k: number; silhouette: number }[] = [];
  let best: ExploredKmeans | null = null;
  const maxK = Math.min(MAX_K, X.length - 1);
  for (let k = MIN_K; k <= maxK; k++) {
    const result = kmeans(X, k, seed + k);
    const silhouette = silhouetteScore(X, result.assignments, k, seed);
    tried.push({ k, silhouette });
    if (best === null || silhouette > best.silhouette) {
      best = { ...result, silhouette, tried: [] };
    }
  }
  if (!best) throw new Error('too-few-rows');
  best.tried = tried;
  return best;
}

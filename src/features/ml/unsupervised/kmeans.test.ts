import { describe, expect, it } from 'vitest';
import { chooseKmeans, kmeans, silhouetteScore } from './kmeans';
import { pca2 } from './pca';

/** Three tight, well-separated blobs (deterministic jitter). */
function blobs(): { X: number[][]; labels: number[] } {
  const centers = [
    [0, 0],
    [10, 0],
    [5, 9],
  ];
  const X: number[][] = [];
  const labels: number[] = [];
  for (let c = 0; c < centers.length; c++) {
    for (let p = 0; p < 20; p++) {
      X.push([centers[c][0] + ((p % 5) - 2) * 0.1, centers[c][1] + ((p % 7) - 3) * 0.1]);
      labels.push(c);
    }
  }
  return { X, labels };
}

describe('kmeans', () => {
  it('recovers three separated blobs exactly (up to relabeling)', () => {
    const { X, labels } = blobs();
    const result = kmeans(X, 3, 42);
    // Every true blob must map to exactly one cluster.
    for (let c = 0; c < 3; c++) {
      const clusterIds = new Set(labels.map((l, i) => (l === c ? result.assignments[i] : -1)));
      clusterIds.delete(-1);
      expect(clusterIds.size).toBe(1);
    }
    expect(new Set(result.assignments).size).toBe(3);
  });

  it('is deterministic for a given seed', () => {
    const { X } = blobs();
    expect(kmeans(X, 3, 42)).toEqual(kmeans(X, 3, 42));
  });

  it('scores separated blobs with a high silhouette', () => {
    const { X } = blobs();
    const result = kmeans(X, 3, 42);
    expect(silhouetteScore(X, result.assignments, 3, 42)).toBeGreaterThan(0.8);
  });
});

describe('chooseKmeans', () => {
  it('picks k = 3 on three blobs, by silhouette', () => {
    const { X } = blobs();
    const explored = chooseKmeans(X, 42);
    expect(explored.k).toBe(3);
    expect(explored.tried.map((t) => t.k)).toEqual([2, 3, 4, 5]);
    const best = Math.max(...explored.tried.map((t) => t.silhouette));
    expect(explored.silhouette).toBe(best);
  });
});

describe('pca2', () => {
  it('finds the main axis of correlated data and orders variance', () => {
    // Points spread along (2, 1) with tiny orthogonal noise.
    const X: number[][] = [];
    for (let i = -20; i <= 20; i++) {
      const noise = ((i % 3) - 1) * 0.05;
      X.push([2 * i + noise * 1, i - noise * 2]);
    }
    const { points, explained } = pca2(X, 42);
    expect(explained[0]).toBeGreaterThan(0.99);
    expect(explained[0] + explained[1]).toBeLessThanOrEqual(1 + 1e-9);
    // The projection preserves the ordering along the main direction.
    const xs = points.map(([x]) => x);
    const sorted = [...xs].sort((a, b) => a - b);
    expect(xs).toEqual(sorted);
  });

  it('is deterministic and centers the projection', () => {
    const X = blobs().X;
    const a = pca2(X, 42);
    expect(pca2(X, 42)).toEqual(a);
    const meanX = a.points.reduce((acc, [x]) => acc + x, 0) / a.points.length;
    expect(Math.abs(meanX)).toBeLessThan(1e-9);
  });
});

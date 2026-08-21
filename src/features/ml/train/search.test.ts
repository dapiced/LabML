import { describe, expect, it } from 'vitest';
import { profileColumn } from '@/features/ml/data/profile';
import { cartesianGrid, kfoldIndices, runSearch, sampleConfigs } from './search';
import type { Cell, ColumnProfile } from '@/features/ml/data/types';
import type { TrainConfig } from './types';

describe('cartesianGrid / sampleConfigs', () => {
  it('enumerates every combination', () => {
    const grid = cartesianGrid({ a: [1, 2], b: [10, 20, 30] });
    expect(grid).toHaveLength(6);
    expect(grid).toContainEqual({ a: 2, b: 30 });
  });

  it('samples without replacement, deterministically', () => {
    const space = { a: [1, 2, 3, 4], b: [1, 2, 3, 4] };
    const first = sampleConfigs(space, 5, 42);
    const second = sampleConfigs(space, 5, 42);
    expect(first).toEqual(second);
    expect(first).toHaveLength(5);
    const keys = new Set(first.map((c) => `${c.a}-${c.b}`));
    expect(keys.size).toBe(5);
  });

  it('returns the full grid when the budget covers it', () => {
    expect(sampleConfigs({ k: [1, 3, 5] }, 16, 42)).toHaveLength(3);
  });
});

describe('kfoldIndices', () => {
  const indices = Array.from({ length: 30 }, (_, i) => i);

  it('produces disjoint folds that cover everything', () => {
    const folds = kfoldIndices(indices, null, 3, 42);
    expect(folds).toHaveLength(3);
    const all = folds.flat().sort((a, b) => a - b);
    expect(all).toEqual(indices);
  });

  it('stratifies classification labels across folds', () => {
    const labels = indices.map((i) => (i < 24 ? 'a' : 'b'));
    const folds = kfoldIndices(indices, labels, 3, 42);
    for (const fold of folds) {
      const b = fold.filter((i) => i >= 24).length;
      expect(b).toBe(2); // 6 'b' rows dealt evenly across 3 folds
    }
  });

  it('is deterministic for a given seed', () => {
    expect(kfoldIndices(indices, null, 3, 42)).toEqual(kfoldIndices(indices, null, 3, 42));
    expect(kfoldIndices(indices, null, 3, 43)).not.toEqual(kfoldIndices(indices, null, 3, 42));
  });
});

describe('runSearch', () => {
  // Tight 3-point clusters on an alternating checkerboard of centers: a small
  // k stays inside the cluster (perfect), a large k drags in opposite-parity
  // neighbors and degrades.
  const x1: Cell[] = [];
  const x2: Cell[] = [];
  const label: Cell[] = [];
  for (let cy = 0; cy < 10; cy++) {
    for (let cx = 0; cx < 8; cx++) {
      for (let p = 0; p < 3; p++) {
        x1.push(String(cx * 2 + (p - 1) * 0.05));
        x2.push(String(cy * 2 + (p - 1) * 0.05));
        label.push((cx + cy) % 2 === 0 ? 'even' : 'odd');
      }
    }
  }
  const columns = new Map<string, Cell[]>([
    ['x1', x1],
    ['x2', x2],
    ['label', label],
  ]);
  const profiles: ColumnProfile[] = [
    profileColumn('x1', x1),
    profileColumn('x2', x2),
    profileColumn('label', label),
  ];
  const config: TrainConfig = {
    target: 'label',
    features: ['x1', 'x2'],
    seed: 42,
    testRatio: 0.2,
  };
  const callbacks = { onProgress: () => {}, isCancelled: () => false };

  it('finds that small k beats large k on the checkerboard, deterministically', async () => {
    const outcome = await runSearch(columns, profiles, config, 'knn', null, callbacks);
    expect(outcome).not.toBeNull();
    expect(outcome!.bestParams.k).toBeLessThanOrEqual(3);
    expect(outcome!.tunedPrimary).toBeGreaterThan(0.9);
    expect(outcome!.trials[0].cvScore).toBe(outcome!.bestCv);
    expect(outcome!.budget).toBe(6); // grid smaller than the budget

    const again = await runSearch(columns, profiles, config, 'knn', null, callbacks);
    expect(again!.bestParams).toEqual(outcome!.bestParams);
    expect(again!.bestCv).toBe(outcome!.bestCv);
    expect(again!.tunedPrimary).toBe(outcome!.tunedPrimary);
  });

  it('stops early when cancelled', async () => {
    let calls = 0;
    const outcome = await runSearch(columns, profiles, config, 'knn', null, {
      onProgress: () => {},
      isCancelled: () => {
        calls += 1;
        return calls > 4;
      },
    });
    expect(outcome).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import {
  familyCost,
  helperCount,
  planBatches,
  HEAVY_FAMILIES,
  MAX_HELPERS,
} from '@/features/ml/train/parallel';
import { NOT_PARALLELISABLE } from '@/features/ml/train/family.worker';
import type { ModelKey } from '@/features/ml/train/types';

// V37: orchestration only — the maths lives in the families. What must hold
// is that the split is balanced, bounded, and never silently drops a family.

const ZOO: ModelKey[] = [
  'baseline',
  'logistic',
  'knn',
  'naiveBayes',
  'tree',
  'forest',
  'gbdt',
  'mlp',
];

describe('helperCount (V37)', () => {
  it('leaves a core for the UI and never exceeds the heavy families', () => {
    expect(helperCount(ZOO, 8)).toBe(MAX_HELPERS);
    expect(helperCount(ZOO, 3)).toBe(2); // cores - 1
    expect(helperCount(ZOO, 1)).toBe(1);
  });

  it('refuses to parallelise when there is nothing to gain', () => {
    // A single heavy family in a helper is pure overhead.
    expect(helperCount(['baseline', 'knn', 'tree'], 8)).toBe(0);
    expect(helperCount(['baseline', 'gbdt'], 8)).toBe(0);
    expect(helperCount(['gbdt', 'mlp'], 8)).toBe(2);
  });
});

describe('planBatches (V37)', () => {
  const heavy = ZOO.filter((key) => familyCost(key) > 1);

  it('never loses a family and never duplicates one', () => {
    for (const helpers of [1, 2, 3, 4]) {
      const batches = planBatches(heavy, helpers, familyCost);
      const flat = batches.flat();
      expect([...flat].sort()).toEqual([...heavy].sort());
      expect(new Set(flat).size).toBe(heavy.length);
    }
  });

  it('balances the load — the slowest helper is what the user waits for', () => {
    const batches = planBatches(heavy, 4, familyCost);
    const loads = batches.map((b) => b.reduce((a, k) => a + familyCost(k), 0));
    // Four heavy families of similar cost: one each, so the spread is small.
    expect(Math.max(...loads) - Math.min(...loads)).toBeLessThanOrEqual(
      Math.max(...heavy.map(familyCost)),
    );
  });

  it('puts the heaviest family first, alone, when helpers are scarce', () => {
    const batches = planBatches(heavy, 2, familyCost);
    expect(batches).toHaveLength(2);
    // mlp is the most expensive in the V37 measurement — it opens a batch.
    expect(batches[0][0]).toBe('mlp');
  });

  it('is deterministic — the same zoo plans the same way', () => {
    expect(planBatches(heavy, 3, familyCost)).toEqual(planBatches(heavy, 3, familyCost));
  });

  it('returns nothing when asked for no helpers', () => {
    expect(planBatches(heavy, 0, familyCost)).toEqual([]);
  });
});

describe('the k-NN rule (V37)', () => {
  it('keeps the one family that cannot be serialised out of the helpers', () => {
    // k-NN has no toJSON (it keeps its training rows) AND costs 0 ms to fit,
    // so shipping it to another core would be both impossible and pointless.
    expect(NOT_PARALLELISABLE.has('knn')).toBe(true);
    expect(HEAVY_FAMILIES).not.toContain('knn');
    expect(familyCost('knn')).toBe(1);
  });
});

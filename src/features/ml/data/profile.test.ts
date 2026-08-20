import { describe, expect, it } from 'vitest';
import { computeNumericStats, profileColumn } from '@/features/ml/data/profile';

describe('computeNumericStats', () => {
  it('computes exact stats on a known series', () => {
    const stats = computeNumericStats([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(stats).toBeDefined();
    expect(stats!.min).toBe(2);
    expect(stats!.max).toBe(9);
    expect(stats!.mean).toBe(5);
    expect(stats!.median).toBe(4.5);
    expect(stats!.std).toBe(2); // population std of the classic example
  });

  it('histogram covers all values and handles a constant series', () => {
    const stats = computeNumericStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const total = stats!.histogram.counts.reduce((a, v) => a + v, 0);
    expect(total).toBe(12);
    const constant = computeNumericStats([5, 5, 5]);
    expect(constant!.histogram.counts).toEqual([3]);
  });
});

describe('profileColumn', () => {
  it('profiles a numeric column with missing values', () => {
    const profile = profileColumn('age', ['10', '20', null, 'NA', '30']);
    expect(profile.type).toBe('numeric');
    expect(profile.rowCount).toBe(5);
    expect(profile.missingCount).toBe(2);
    expect(profile.cardinality).toBe(3);
    expect(profile.numeric?.mean).toBe(20);
    expect(profile.topValues).toBeUndefined();
  });

  it('profiles a categorical column with sorted top values', () => {
    const profile = profileColumn('class', ['a', 'b', 'a', 'c', 'a', 'b', null]);
    expect(profile.type).toBe('categorical');
    expect(profile.missingCount).toBe(1);
    expect(profile.cardinality).toBe(3);
    expect(profile.topValues?.[0]).toEqual({ value: 'a', count: 3 });
    expect(profile.topValues?.[1]).toEqual({ value: 'b', count: 2 });
  });
});

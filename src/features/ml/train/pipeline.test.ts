import { describe, expect, it } from 'vitest';
import { profileColumn } from '@/features/ml/data/profile';
import { fitPipeline, splitIndices, usableRows } from '@/features/ml/train/pipeline';
import type { Cell } from '@/features/ml/data/types';

function setup(data: Record<string, Cell[]>) {
  const columns = new Map(Object.entries(data));
  const profiles = Object.entries(data).map(([name, values]) => profileColumn(name, values));
  return { columns, profiles };
}

describe('fitPipeline', () => {
  it('standardizes numeric features with train statistics only', () => {
    const { columns, profiles } = setup({ x: ['1', '2', '3', '100'] });
    const pipeline = fitPipeline(columns, profiles, ['x'], [0, 1, 2]);
    const train = pipeline.transform([0, 1, 2]).map((r) => r[0]);
    const mean = train.reduce((a, v) => a + v, 0) / train.length;
    expect(mean).toBeCloseTo(0, 12);
    // The held-out row uses train mean/std — it lands far outside [-2, 2].
    const test = pipeline.transform([3])[0][0];
    expect(test).toBeGreaterThan(10);
  });

  it('imputes missing numeric values with the train median', () => {
    const { columns, profiles } = setup({ x: ['10', '20', '30', null] });
    const pipeline = fitPipeline(columns, profiles, ['x'], [0, 1, 2]);
    // Median of train = 20 → standardized to (20 - 20)/std = 0.
    expect(pipeline.transform([3])[0][0]).toBeCloseTo(0, 12);
  });

  it('one-hot encodes small categorical columns and ignores unseen categories', () => {
    const { columns, profiles } = setup({ c: ['a', 'b', 'a', 'c'] });
    const pipeline = fitPipeline(columns, profiles, ['c'], [0, 1, 2]);
    expect(pipeline.featureNames).toEqual(['c=a', 'c=b']);
    expect(pipeline.transform([0])[0]).toEqual([1, 0]);
    // 'c' was never seen on the train side → encodes to all zeros.
    expect(pipeline.transform([3])[0]).toEqual([0, 0]);
  });

  it('falls back to a single ordinal feature for high-cardinality columns', () => {
    const values = Array.from({ length: 60 }, (_, i) => `cat_${i % 20}`);
    const { columns, profiles } = setup({ c: values });
    const pipeline = fitPipeline(
      columns,
      profiles,
      ['c'],
      values.map((_, i) => i),
    );
    expect(pipeline.featureNames).toEqual(['c']);
  });
});

describe('splitIndices', () => {
  it('stratifies classification splits and stays deterministic per seed', () => {
    const rows = Array.from({ length: 100 }, (_, i) => i);
    const labels = rows.map((i) => (i < 50 ? 'a' : 'b'));
    const first = splitIndices(rows, labels, 0.2, 42);
    const again = splitIndices(rows, labels, 0.2, 42);
    const other = splitIndices(rows, labels, 0.2, 7);
    expect(first.test).toHaveLength(20);
    expect(first.train).toHaveLength(80);
    expect(first.test.filter((i) => i < 50)).toHaveLength(10); // 10 of each class
    expect(again.test).toEqual(first.test);
    expect(other.test).not.toEqual(first.test);
    // No overlap, full coverage.
    expect([...first.train, ...first.test].sort((a, b) => a - b)).toEqual(rows);
  });
});

describe('usableRows', () => {
  it('drops rows whose target is missing', () => {
    expect(usableRows(['a', null, 'NA', 'b'])).toEqual([0, 3]);
  });
});

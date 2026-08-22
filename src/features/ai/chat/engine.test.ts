import { describe, expect, it } from 'vitest';
import { aggregate, pearson, runQuery, type Table } from './engine';

const table: Table = {
  header: ['city', 'price', 'quantity'],
  columns: [
    ['Paris', 'Lyon', 'Paris', 'Lyon', 'Paris', null],
    ['10', '20', '30', '40', '50', '60'],
    ['1', '2', '3', 'NA', '5', '6'],
  ],
};

describe('aggregate', () => {
  it('computes every operation on a hand-checked list', () => {
    const values = [1, 2, 3, 4];
    expect(aggregate(values, 'mean')).toBe(2.5);
    expect(aggregate(values, 'median')).toBe(2.5);
    expect(aggregate([1, 2, 3], 'median')).toBe(2);
    expect(aggregate(values, 'sum')).toBe(10);
    expect(aggregate(values, 'min')).toBe(1);
    expect(aggregate(values, 'max')).toBe(4);
    expect(aggregate(values, 'count')).toBe(4);
    expect(aggregate(values, 'std')).toBeCloseTo(Math.sqrt(1.25), 10);
    expect(aggregate([], 'mean')).toBeNaN();
  });
});

describe('pearson', () => {
  it('is 1 on a perfect line and 0-ish on a constant', () => {
    expect(pearson([1, 2, 3], [10, 20, 30])).toBeCloseTo(1, 10);
    expect(pearson([1, 2, 3], [30, 20, 10])).toBeCloseTo(-1, 10);
    expect(pearson([1, 2, 3], [5, 5, 5])).toBeNaN();
  });
});

describe('runQuery', () => {
  it('aggregates with a numeric filter', () => {
    const result = runQuery(table, {
      kind: 'aggregate',
      op: 'mean',
      column: 'price',
      filter: { column: 'quantity', op: '>', value: 2 },
    });
    // rows with quantity > 2: 30, 50, 60 (NA skipped)
    expect(result.rowsConsidered).toBe(3);
    expect(result.scalar).toBeCloseTo((30 + 50 + 60) / 3, 10);
  });

  it('aggregates grouped by a category, missing keys skipped', () => {
    const result = runQuery(table, {
      kind: 'aggregate',
      op: 'sum',
      column: 'price',
      groupBy: 'city',
    });
    expect(result.groups).toEqual([
      { key: 'Paris', value: 90, count: 3 },
      { key: 'Lyon', value: 60, count: 2 },
    ]);
  });

  it('counts with a categorical equality filter, case-insensitively', () => {
    const result = runQuery(table, {
      kind: 'count',
      filter: { column: 'city', op: '=', value: 'paris' },
    });
    expect(result.scalar).toBe(3);
  });

  it('ranks top-k groups by a metric', () => {
    const result = runQuery(table, {
      kind: 'topk',
      groupBy: 'city',
      k: 1,
      op: 'max',
      column: 'price',
    });
    expect(result.groups).toEqual([{ key: 'Paris', value: 50, count: 3 }]);
  });

  it('reports distribution, missing cells and shape', () => {
    expect(runQuery(table, { kind: 'distribution', column: 'city' }).distribution).toEqual([
      { label: 'Paris', count: 3 },
      { label: 'Lyon', count: 2 },
    ]);
    expect(runQuery(table, { kind: 'missing' }).missing).toEqual([
      { column: 'city', count: 1 },
      { column: 'quantity', count: 1 },
    ]);
    expect(runQuery(table, { kind: 'shape' }).shape).toEqual({ rows: 6, columns: 3 });
  });

  // V27.2 — `rowsConsidered` counts rows, not values: a mean skips the cells it
  // cannot read, and the answer has to say so rather than imply every row had a
  // number. Correlation already reported usable pairs; aggregates now match.
  it('reports how many values a mean actually used', () => {
    const result = runQuery(table, { kind: 'aggregate', op: 'mean', column: 'quantity' });
    // (1+2+3+5+6)/5 = 3.4 — the 'NA' row contributes nothing.
    expect(result.scalar).toBeCloseTo(3.4, 10);
    expect(result.rowsConsidered).toBe(6);
    expect(result.valuesUsed).toBe(5);
  });

  it('leaves valuesUsed unset when every row carried a number', () => {
    const result = runQuery(table, { kind: 'aggregate', op: 'mean', column: 'price' });
    expect(result.rowsConsidered).toBe(6);
    expect(result.valuesUsed).toBeUndefined();
  });

  it('marks the groups whose average rests on fewer rows than they hold', () => {
    const result = runQuery(table, {
      kind: 'aggregate',
      op: 'mean',
      column: 'quantity',
      groupBy: 'city',
    });
    // Paris has three readable quantities; Lyon holds two rows but one is 'NA'.
    expect(result.groups).toEqual([
      { key: 'Paris', value: 3, count: 3 },
      { key: 'Lyon', value: 2, count: 2, used: 1 },
    ]);
  });

  it('computes correlation on jointly-present numeric pairs', () => {
    const result = runQuery(table, { kind: 'correlation', a: 'price', b: 'quantity' });
    // pairs (10,1) (20,2) (30,3) (50,5) (60,6) — the NA row drops out.
    expect(result.rowsConsidered).toBe(5);
    expect(result.correlation).toBeCloseTo(1, 10);
  });
});

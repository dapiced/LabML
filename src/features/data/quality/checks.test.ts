import { describe, expect, it } from 'vitest';
import {
  buildQualityReport,
  duplicateRowIndices,
  messyGroups,
  outlierFences,
  quantileSorted,
} from './checks';
import type { Cell } from '@/features/ml/data/types';

describe('quantileSorted', () => {
  it('interpolates linearly', () => {
    expect(quantileSorted([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantileSorted([1, 2, 3, 4, 5], 0.25)).toBe(2);
    expect(quantileSorted([10], 0.75)).toBe(10);
  });
});

describe('outlierFences', () => {
  it('computes Tukey fences and flags the planted outlier', () => {
    // 1..12 with one extreme value appended.
    const values: Cell[] = [...Array.from({ length: 12 }, (_, i) => String(i + 1)), '999'];
    const fences = outlierFences(values);
    expect(fences).not.toBeNull();
    expect(fences!.high).toBeLessThan(999);
    expect(fences!.low).toBeLessThanOrEqual(1);
  });

  it('returns null on tiny or constant columns', () => {
    expect(outlierFences(['1', '2', '3'])).toBeNull();
    expect(outlierFences(Array.from({ length: 20 }, () => '5'))).toBeNull();
  });
});

describe('messyGroups', () => {
  it('groups case and whitespace variants under the most frequent spelling', () => {
    const values: Cell[] = ['Paris', 'Paris', 'paris', ' Paris ', 'Lyon', 'Lyon'];
    const groups = messyGroups(values);
    expect(groups).toHaveLength(1);
    expect(groups[0].canonical).toBe('Paris');
    expect(groups[0].cellCount).toBe(2);
    expect(groups[0].variants).toContain('paris');
  });

  it('breaks frequency ties alphabetically for determinism', () => {
    const groups = messyGroups(['b', 'B']);
    expect(groups[0].canonical).toBe('b'); // localeCompare orders 'b' before 'B'
  });

  it('reports nothing when spellings are consistent', () => {
    expect(messyGroups(['a', 'a', 'b'])).toHaveLength(0);
  });
});

describe('duplicateRowIndices', () => {
  it('counts repeats of earlier rows only', () => {
    const columns: Cell[][] = [
      ['a', 'b', 'a', 'a'],
      ['1', '2', '1', '3'],
    ];
    expect(duplicateRowIndices(columns, 4)).toEqual([2]);
  });

  it('does not collide on concatenation boundaries', () => {
    const columns: Cell[][] = [
      ['ab', 'a'],
      ['c', 'bc'],
    ];
    expect(duplicateRowIndices(columns, 2)).toEqual([]);
  });

  it('distinguishes null from spelled-out emptiness', () => {
    const columns: Cell[][] = [
      [null, ''],
      ['x', 'x'],
    ];
    expect(duplicateRowIndices(columns, 2)).toEqual([]);
  });
});

describe('buildQualityReport', () => {
  const header = ['city', 'price', 'currency', 'order_id'];
  const rows = 20;
  const city: Cell[] = Array.from({ length: rows }, (_, i) =>
    i === 3 ? 'paris' : i % 2 === 0 ? 'Paris' : 'Lyon',
  );
  city[5] = null;
  const price: Cell[] = Array.from({ length: rows }, (_, i) => String(10 + (i % 7)));
  price[8] = '9999';
  const currency: Cell[] = Array.from({ length: rows }, () => 'EUR');
  const orderId: Cell[] = Array.from({ length: rows }, (_, i) => String(1000 + i));

  it('assembles every issue family with counts', () => {
    const report = buildQualityReport(header, [city, price, currency, orderId]);
    expect(report.rowCount).toBe(rows);
    expect(report.missingCells).toBe(1);
    expect(report.missingColumns[0]).toMatchObject({ column: 'city', count: 1 });
    expect(report.messyColumns[0].column).toBe('city');
    expect(report.messyCells).toBe(1);
    expect(report.outlierColumns[0]).toMatchObject({ column: 'price', count: 1 });
    expect(report.structural).toContainEqual({ column: 'currency', kind: 'constant' });
    expect(report.structural).toContainEqual({ column: 'order_id', kind: 'id' });
    expect(report.score).toBeGreaterThan(0);
    expect(report.score).toBeLessThan(100);
  });

  it('gives a clean dataset a perfect score', () => {
    const clean = buildQualityReport(
      ['a', 'b'],
      [
        Array.from({ length: 10 }, (_, i) => `v${i % 3}`),
        Array.from({ length: 10 }, (_, i) => String(i)),
      ],
    );
    expect(clean.score).toBe(100);
    expect(clean.duplicateRows).toBe(0);
    expect(clean.messyColumns).toHaveLength(0);
  });

  it('is monotone: more dirt, lower score', () => {
    const base = buildQualityReport(header, [city, price, currency, orderId]);
    const dirtierCity = [...city];
    dirtierCity[0] = null;
    dirtierCity[1] = null;
    const dirtier = buildQualityReport(header, [dirtierCity, price, currency, orderId]);
    expect(dirtier.score).toBeLessThan(base.score);
  });
});

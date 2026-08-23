/**
 * V40 — cross-column consistency, in JavaScript rather than in SQL.
 */
import { describe, expect, it } from 'vitest';
import {
  checkConsistency,
  inconsistentRowCount,
  PRODUCT_TOLERANCE,
} from '@/features/data/quality/consistency';
import type { Cell } from '@/features/ml/data/types';

describe('V40 — a row can be impossible even when every cell is fine', () => {
  it('flags an end date before its start date', () => {
    const header = ['date_debut', 'date_fin'];
    const columns: Cell[][] = [
      ['2025-01-04', '2025-02-01', '2025-03-10', '2025-04-01', '2025-05-01', '2025-06-01'],
      ['2025-01-09', '2025-02-05', '2025-02-28', '2025-04-10', '2025-05-06', '2025-06-08'],
    ];
    const [found] = checkConsistency(header, columns);
    expect(found.rule).toBe('dateOrder');
    expect(found.columns).toEqual(['date_debut', 'date_fin']);
    expect(found.rows).toEqual([2]);
    expect(found.examples).toEqual(['2025-03-10 → 2025-02-28']);
  });

  it('flags a total that is not quantity × unit price', () => {
    const header = ['quantite', 'prix_unitaire', 'total'];
    const columns: Cell[][] = [
      ['2', '3', '1', '4', '5', '2'],
      ['5', '2.5', '10', '1.25', '2', '3'],
      ['10', '7.5', '99', '5', '10', '6'],
    ];
    const [found] = checkConsistency(header, columns);
    expect(found.rule).toBe('productMismatch');
    expect(found.rows).toEqual([2]);
    expect(found.examples).toEqual(['1 × 10 ≠ 99']);
  });

  it('tolerates ordinary rounding on money', () => {
    const header = ['qty', 'unit_price', 'total'];
    const columns: Cell[][] = [
      ['3', '3', '3', '3', '3', '3'],
      ['0.3333', '0.3333', '0.3333', '0.3333', '0.3333', '0.3333'],
      ['1', '1', '1', '1', '1', '1'],
    ];
    // 3 × 0.3333 = 0.9999, rounded to 1 — a rounded total is not a wrong total.
    expect(checkConsistency(header, columns)).toEqual([]);
    expect(PRODUCT_TOLERANCE).toBeLessThanOrEqual(0.01);
  });
});

describe('V40 — consistency rules refuse to fire on a file they misread', () => {
  it('REFUSES when most rows disagree — the columns are not what it assumed', () => {
    // `total` here is a running balance, not quantity × price.
    const header = ['quantite', 'prix_unitaire', 'total'];
    const columns: Cell[][] = [
      ['2', '3', '1', '4', '5', '2'],
      ['5', '2.5', '10', '1.25', '2', '3'],
      ['100', '250', '380', '420', '600', '750'],
    ];
    expect(checkConsistency(header, columns)).toEqual([]);
  });

  it('REFUSES a date pair whose values are not dates', () => {
    const header = ['debut', 'fin'];
    const columns: Cell[][] = [
      ['tôt', 'tôt', 'tard', 'tôt', 'tard', 'tôt'],
      ['tard', 'tard', 'tôt', 'tard', 'tôt', 'tard'],
    ];
    expect(checkConsistency(header, columns)).toEqual([]);
  });

  it('does not charge a row twice when one endpoint is simply missing', () => {
    const header = ['date_debut', 'date_fin'];
    const columns: Cell[][] = [
      ['2025-01-04', '2025-02-01', '2025-03-10', '2025-04-01', '2025-05-01', '2025-06-01'],
      ['2025-01-09', '', '2025-04-01', '2025-04-10', '2025-05-06', '2025-06-08'],
    ];
    // Row 1 is missing, not inconsistent — the missing report already has it.
    expect(checkConsistency(header, columns)).toEqual([]);
  });

  it('says nothing when the columns it needs are absent', () => {
    expect(
      checkConsistency(
        ['a', 'b'],
        [
          ['1', '2'],
          ['3', '4'],
        ],
      ),
    ).toEqual([]);
    expect(inconsistentRowCount([])).toBe(0);
  });

  it('never modifies the data it inspects', () => {
    const header = ['date_debut', 'date_fin'];
    const columns: Cell[][] = [
      ['2025-03-10', '2025-01-04', '2025-02-01', '2025-04-01', '2025-05-01', '2025-06-01'],
      ['2025-02-28', '2025-01-09', '2025-02-05', '2025-04-10', '2025-05-06', '2025-06-08'],
    ];
    const snapshot = columns.map((column) => [...column]);
    checkConsistency(header, columns);
    expect(columns).toEqual(snapshot);
  });
});

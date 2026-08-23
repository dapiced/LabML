/**
 * V40 — validity.
 *
 * As in V38's reader, the tests that matter most are the ones asserting the
 * module REFUSES to fire: a rule that flags a good file is worse than no rule,
 * because it teaches the user to ignore the panel.
 */
import { describe, expect, it } from 'vitest';
import {
  APPLICABILITY,
  checkColumn,
  checkValidity,
  invalidCellCount,
} from '@/features/data/quality/validity';
import type { Cell } from '@/features/ml/data/types';

/** A fixed "now" so "the future" never depends on when the suite runs. */
const NOW = Date.UTC(2026, 7, 23);

describe('V40 — a value can be present, well-typed and still impossible', () => {
  it('flags an age outside 0–120, naming the rows and the bound', () => {
    const values: Cell[] = ['34', '41', '200', '29', '52', '61', '18', '77', '-3', '45'];
    const [found] = checkColumn('age', values, NOW);
    expect(found.rule).toBe('ageRange');
    expect(found.count).toBe(2);
    expect(found.rows).toEqual([2, 8]);
    expect(found.examples).toEqual(['200', '-3']);
    expect(found.bound).toEqual({ min: 0, max: 120 });
  });

  it('flags a date in the future', () => {
    const values: Cell[] = [
      '2025-01-04',
      '2025-06-11',
      '2087-03-02',
      '2024-12-31',
      '2025-02-02',
      '2025-03-03',
    ];
    const [found] = checkColumn('date_vente', values, NOW);
    expect(found.rule).toBe('futureDate');
    expect(found.rows).toEqual([2]);
  });

  it('flags a percentage above 100 and a negative amount', () => {
    const pct = checkColumn('taux_reussite', ['12', '54', '130', '77', '90', '31'], NOW);
    expect(pct[0].rule).toBe('percentRange');
    expect(pct[0].examples).toEqual(['130']);

    const amount = checkColumn('prix', ['12.5', '3.25', '-8', '48.9', '7.1', '99'], NOW);
    expect(amount[0].rule).toBe('negativeAmount');
    expect(amount[0].examples).toEqual(['-8']);
  });

  it('flags a malformed postcode among well-formed ones', () => {
    const values: Cell[] = ['H2X 1Y4', '75008', 'G1R2B5', '13001', 'ABC', 'H3Z 2Y7'];
    const [found] = checkColumn('code_postal', values, NOW);
    expect(found.rule).toBe('postcodeShape');
    expect(found.examples).toEqual(['ABC']);
  });
});

describe('V40 — a rule fires on evidence, never on a column name alone', () => {
  it('REFUSES an "age" column that is plainly a duration, not a person', () => {
    // Ages in days: every value is above 120, so the rule is not applicable —
    // flagging all ten rows would be the rule being wrong, not the data.
    const values: Cell[] = [
      '3200',
      '5400',
      '900',
      '12000',
      '7800',
      '4300',
      '6100',
      '2200',
      '9900',
      '15000',
    ];
    expect(checkColumn('age_jours', values, NOW)).toEqual([]);
  });

  it('REFUSES a rate written on a 0–1 scale', () => {
    const values: Cell[] = ['0.12', '0.54', '0.9', '0.77', '0.31', '0.66'];
    expect(checkColumn('taux_conversion', values, NOW)).toEqual([]);
  });

  it('REFUSES a ledger column that is routinely negative', () => {
    const values: Cell[] = ['-12', '-3', '45', '-8', '-99', '-40'];
    expect(checkColumn('montant_ajustement', values, NOW)).toEqual([]);
  });

  it('REFUSES a column whose name matches but whose values are not that thing', () => {
    // "date_label" holds free text, not dates: nothing to check.
    const values: Cell[] = ['hiver', 'été', 'printemps', 'automne', 'hiver', 'été'];
    expect(checkColumn('date_label', values, NOW)).toEqual([]);
  });

  it('REFUSES every rule on a column whose name matches nothing', () => {
    expect(checkColumn('ville', ['Québec', 'Montréal', '200', '-8'], NOW)).toEqual([]);
  });

  it('keeps the applicability floor high enough to mean something', () => {
    expect(APPLICABILITY).toBeGreaterThanOrEqual(0.8);
  });

  it('stops applying a rule once too much of the column contradicts it', () => {
    // 8 of 10 plausible: exactly at the floor, so the rule still fires.
    const atFloor: Cell[] = ['34', '200', '201', '29', '52', '61', '18', '77', '45', '38'];
    expect(checkColumn('age', atFloor, NOW)[0].count).toBe(2);

    // 7 of 10 plausible: below the floor. A column a third of which is
    // "invalid" is a column the rule has misunderstood, so it says nothing
    // rather than flagging thirty rows of a good file.
    const belowFloor: Cell[] = ['34', '200', '201', '202', '29', '52', '61', '18', '77', '45'];
    expect(checkColumn('age', belowFloor, NOW)).toEqual([]);
  });
});

describe('V40 — findings are reported, never repaired', () => {
  it('does not touch the values it flags', () => {
    const values: Cell[] = ['34', '41', '200', '29', '52', '61'];
    const before = [...values];
    checkColumn('age', values, NOW);
    // V39's recipe is where data changes; a check that quietly repaired what it
    // found would put edits outside the one record of what was done.
    expect(values).toEqual(before);
  });

  it('caps the listed rows but never the count', () => {
    const values: Cell[] = Array.from({ length: 100 }, (_, i) => (i < 20 ? '999' : '40'));
    const [found] = checkColumn('age', values, NOW);
    expect(found.count).toBe(20);
    expect(found.rows.length).toBe(10);
  });

  it('orders findings worst first and totals the impossible cells', () => {
    const header = ['age', 'prix'];
    const columns: Cell[][] = [
      ['34', '200', '201', '29', '52', '61', '18', '77', '45', '38'],
      ['12.5', '-8', '48.9', '7.1', '99', '3.25', '5', '6', '7', '8'],
    ];
    const findings = checkValidity(header, columns, NOW);
    expect(findings.map((f) => f.column)).toEqual(['age', 'prix']);
    expect(invalidCellCount(findings)).toBe(3);
  });

  it('returns nothing at all for a clean file', () => {
    const header = ['age', 'prix', 'date_vente'];
    const columns: Cell[][] = [
      ['34', '41', '29', '52', '61', '18'],
      ['12.5', '3.25', '48.9', '7.1', '99', '5'],
      ['2025-01-04', '2025-06-11', '2024-12-31', '2025-02-02', '2025-03-03', '2025-04-04'],
    ];
    expect(checkValidity(header, columns, NOW)).toEqual([]);
    expect(invalidCellCount([])).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { buildDriftReport, psi, severityOf } from './drift';
import type { Cell } from '@/features/ml/data/types';

describe('psi / severityOf', () => {
  it('is ~0 on identical distributions', () => {
    expect(psi([0.5, 0.5], [0.5, 0.5])).toBeCloseTo(0, 10);
  });

  it('matches the hand-computed value on a 50/50 → 90/10 shift', () => {
    // (0.9−0.5)·ln(0.9/0.5) + (0.1−0.5)·ln(0.1/0.5) ≈ 0.8789
    expect(psi([0.5, 0.5], [0.9, 0.1])).toBeCloseTo(0.8789, 3);
  });

  it('stays finite when a bin empties out', () => {
    expect(Number.isFinite(psi([0.5, 0.5], [1, 0]))).toBe(true);
  });

  it('applies the conventional 0.1 / 0.25 thresholds', () => {
    expect(severityOf(0.05)).toBe('stable');
    expect(severityOf(0.15)).toBe('moderate');
    expect(severityOf(0.3)).toBe('strong');
  });
});

describe('buildDriftReport', () => {
  const n = 100;
  const refPrice: Cell[] = Array.from({ length: n }, (_, i) => String(10 + (i % 10)));
  const refCity: Cell[] = Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 'Paris' : 'Lyon'));

  it('reports no drift when the new batch matches the reference', () => {
    const report = buildDriftReport(
      ['price', 'city'],
      [refPrice, refCity],
      ['price', 'city'],
      [refPrice, refCity],
    );
    expect(report.severity).toBe('stable');
    expect(report.driftedColumns).toBe(0);
    for (const column of report.columns) expect(column.psi).toBeLessThan(0.01);
  });

  it('flags a strong numeric shift and reports both means', () => {
    const shifted: Cell[] = Array.from({ length: n }, (_, i) => String(30 + (i % 10)));
    const report = buildDriftReport(['price'], [refPrice], ['price'], [shifted]);
    const price = report.columns[0];
    expect(price.severity).toBe('strong');
    expect(price.refMean).toBeCloseTo(14.5, 5);
    expect(price.newMean).toBeCloseTo(34.5, 5);
    expect(report.severity).toBe('strong');
  });

  it('detects new and vanished categories with a categorical PSI', () => {
    const newCity: Cell[] = Array.from({ length: n }, (_, i) =>
      i % 3 === 0 ? 'Matcha-Ville' : 'Paris',
    );
    const report = buildDriftReport(['city'], [refCity], ['city'], [newCity]);
    const city = report.columns[0];
    expect(city.newCategories).toEqual(['Matcha-Ville']);
    expect(city.goneCategories).toEqual(['Lyon']);
    expect(city.severity).toBe('strong');
  });

  it('diffs the schema: added, removed and re-typed columns', () => {
    const asText: Cell[] = Array.from({ length: n }, (_, i) => `ref-${i}-${(i * 7) % 13}`);
    const report = buildDriftReport(
      ['price', 'old'],
      [refPrice, refCity],
      ['price', 'fresh'],
      [asText, refCity],
    );
    expect(report.schema.added).toEqual(['fresh']);
    expect(report.schema.removed).toEqual(['old']);
    expect(report.schema.typeChanged).toEqual([{ column: 'price', from: 'numeric', to: 'text' }]);
    // Schema changes alone already make the batch non-stable.
    expect(report.severity).not.toBe('stable');
  });

  it('keeps identifier-like columns out of the PSI table', () => {
    // Reference ids repeat (duplicated rows) so they read as numeric; the new
    // batch's ids are fresh and unique, so they read as an identifier. Their
    // "drift" is meaningless — only the schema diff should report the retype.
    const refIds: Cell[] = Array.from({ length: n }, (_, i) => String(1001 + (i % 60)));
    const newIds: Cell[] = Array.from({ length: n }, (_, i) => String(2001 + i));
    const report = buildDriftReport(['order_id'], [refIds], ['order_id'], [newIds]);
    expect(report.columns).toEqual([]);
    expect(report.schema.typeChanged).toEqual([{ column: 'order_id', from: 'numeric', to: 'id' }]);
    expect(report.severity).toBe('moderate');
  });

  it('tracks missing-rate shifts', () => {
    const holey: Cell[] = refPrice.map((v, i) => (i % 4 === 0 ? null : v));
    const report = buildDriftReport(['price'], [refPrice], ['price'], [holey]);
    expect(report.columns[0].refMissingRatio).toBe(0);
    expect(report.columns[0].newMissingRatio).toBeCloseTo(0.25, 10);
  });
});

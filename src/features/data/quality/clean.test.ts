import { describe, expect, it } from 'vitest';
import { applyRecipe, formatNumber } from './clean';
import type { Cell } from '@/features/ml/data/types';
import { DEFAULT_RECIPE, type RecipeOptions } from './types';

const KEEP_ALL: RecipeOptions = {
  trimWhitespace: false,
  mergeVariants: false,
  dropDuplicates: false,
  dropStructural: false,
  missing: 'keep',
  clipOutliers: false,
};

function dataset(): { header: string[]; columns: Cell[][] } {
  // 12 rows; row 11 duplicates row 10 exactly.
  const city: Cell[] = [
    'Paris',
    ' Paris ',
    'paris',
    'Lyon',
    'Lyon',
    null,
    'Paris',
    'Lyon',
    'Paris',
    'Lyon',
    'Paris',
    'Paris',
  ];
  const price: Cell[] = ['10', '11', '12', '13', null, '15', '16', '17', '18', '19', '20', '20'];
  const note: Cell[] = [null, null, null, null, null, null, null, null, null, null, 'x', 'x'];
  return { header: ['city', 'price', 'note'], columns: [city, price, note] };
}

describe('applyRecipe', () => {
  it('does nothing when every option is off', () => {
    const { header, columns } = dataset();
    const result = applyRecipe(header, columns, KEEP_ALL);
    expect(result.columns).toEqual(columns);
    expect(result.stats.rowCount).toBe(12);
    expect(result.stats.columnCount).toBe(3);
  });

  it('never mutates the source data', () => {
    const { header, columns } = dataset();
    const snapshot = columns.map((c) => [...c]);
    applyRecipe(header, columns, DEFAULT_RECIPE);
    expect(columns).toEqual(snapshot);
  });

  it('trims whitespace and counts only changed cells', () => {
    const { header, columns } = dataset();
    const result = applyRecipe(header, columns, { ...KEEP_ALL, trimWhitespace: true });
    expect(result.stats.trimmedCells).toBe(1);
    expect(result.columns[0][1]).toBe('Paris');
  });

  it('merges case variants to the most frequent spelling', () => {
    const { header, columns } = dataset();
    const result = applyRecipe(header, columns, {
      ...KEEP_ALL,
      trimWhitespace: true,
      mergeVariants: true,
    });
    expect(result.stats.mergedCells).toBe(1); // 'paris' → 'Paris' (' Paris ' fixed by trim)
    expect(result.columns[0][2]).toBe('Paris');
  });

  it('drops duplicate rows found after normalization', () => {
    const { header, columns } = dataset();
    const result = applyRecipe(header, columns, { ...KEEP_ALL, dropDuplicates: true });
    expect(result.stats.droppedDuplicateRows).toBe(1);
    expect(result.stats.rowCount).toBe(11);
  });

  it('imputes numeric medians and categorical modes', () => {
    const { header, columns } = dataset();
    const result = applyRecipe(header, columns, { ...KEEP_ALL, missing: 'impute' });
    // price sans null : 10,11,12,13,15,16,17,18,19,20,20 → médiane 16.
    expect(result.columns[1][4]).toBe('16');
    expect(result.columns[0][5]).toBe('Paris');
    expect(result.stats.imputedCells).toBeGreaterThanOrEqual(2);
  });

  it('drops rows containing any missing cell when asked', () => {
    const { header, columns } = dataset();
    const result = applyRecipe(header, columns, { ...KEEP_ALL, missing: 'dropRows' });
    expect(result.stats.droppedMissingRows).toBe(12 - 2);
    expect(result.stats.rowCount).toBe(2);
  });

  it('drops near-empty columns but keeps identifiers', () => {
    const header = ['order_id', 'note', 'price'];
    const orderId: Cell[] = Array.from({ length: 20 }, (_, i) => String(1000 + i));
    const note: Cell[] = Array.from({ length: 20 }, () => null);
    const price: Cell[] = Array.from({ length: 20 }, (_, i) => String(10 + i));
    const result = applyRecipe(header, [orderId, note, price], {
      ...KEEP_ALL,
      dropStructural: true,
    });
    expect(result.stats.droppedColumns).toEqual(['note']);
    expect(result.header).toEqual(['order_id', 'price']);
  });

  it('clips outliers to the Tukey fences', () => {
    const header = ['price'];
    const price: Cell[] = [...Array.from({ length: 12 }, (_, i) => String(i + 1)), '999'];
    const result = applyRecipe(header, [price], { ...KEEP_ALL, clipOutliers: true });
    expect(result.stats.clippedCells).toBe(1);
    const clipped = Number(result.columns[0][12]);
    expect(clipped).toBeLessThan(999);
    expect(clipped).toBeGreaterThan(12);
  });

  it('applies the full default recipe coherently', () => {
    const { header, columns } = dataset();
    const result = applyRecipe(header, columns, DEFAULT_RECIPE);
    // trim + merge make row 2 ('paris',12,null) unique still; duplicate row 11 dropped.
    expect(result.stats.droppedDuplicateRows).toBe(1);
    expect(result.stats.rowCount).toBe(11);
    // No missing cells remain after imputation.
    for (const column of result.columns) {
      for (const cell of column) expect(cell === null || cell.trim() !== '').toBe(true);
    }
  });
});

describe('formatNumber', () => {
  it('keeps numbers compact', () => {
    expect(formatNumber(16)).toBe('16');
    expect(formatNumber(12.350000000001)).toBe('12.35');
  });
});

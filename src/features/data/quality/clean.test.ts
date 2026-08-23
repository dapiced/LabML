import { describe, expect, it } from 'vitest';
import { applyRecipe, formatNumber } from './clean';
import type { Cell } from '@/features/ml/data/types';
import { DEFAULT_RECIPE, parseRecipeFile, type RecipeOptions } from './types';

const KEEP_ALL: RecipeOptions = {
  trimWhitespace: false,
  mergeVariants: false,
  dropDuplicates: false,
  dropStructural: false,
  missing: 'keep',
  clipOutliers: false,
  dropAnomalies: false,
  deriveDates: false,
  types: {},
  columns: {},
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

describe('applyRecipe — V10', () => {
  it('derives year, month and weekday from date columns', () => {
    const header = ['date', 'kwh'];
    const date: Cell[] = ['2026-05-03', '2026-05-04', 'oops', null];
    const kwh: Cell[] = ['1', '2', '3', '4'];
    // Too dirty for inference (2 valid dates out of 3 non-missing): the forced
    // 'date' type is what makes the expansion possible.
    const result = applyRecipe(header, [date, kwh], {
      ...KEEP_ALL,
      deriveDates: true,
      types: { date: 'date' },
    });
    expect(result.header).toEqual(['date', 'kwh', 'date_year', 'date_month', 'date_weekday']);
    expect(result.stats.derivedColumns).toEqual(['date_year', 'date_month', 'date_weekday']);
    // 2026-05-03 is a Sunday.
    expect(result.columns[2][0]).toBe('2026');
    expect(result.columns[3][0]).toBe('05');
    expect(result.columns[4][0]).toBe('sun');
    expect(result.columns[4][1]).toBe('mon');
    // Unparseable and missing dates yield missing derived cells.
    expect(result.columns[2][2]).toBeNull();
    expect(result.columns[2][3]).toBeNull();
  });

  it('honors forced column types during imputation', () => {
    const header = ['code'];
    // Looks numeric, but forced categorical: the mode (not the median) fills in.
    const code: Cell[] = ['1', '1', '9', null];
    const asNumeric = applyRecipe(header, [code], { ...KEEP_ALL, missing: 'impute' });
    expect(asNumeric.columns[0][3]).toBe('1'); // median of 1,1,9
    const asCategorical = applyRecipe(header, [code], {
      ...KEEP_ALL,
      missing: 'impute',
      types: { code: 'categorical' },
    });
    expect(asCategorical.columns[0][3]).toBe('1'); // mode — same value here…
    const spread: Cell[] = ['2', '9', '9', null];
    const numericSpread = applyRecipe(header, [spread], { ...KEEP_ALL, missing: 'impute' });
    expect(numericSpread.columns[0][3]).toBe('9'); // median of 2,9,9
    const categoricalSpread = applyRecipe(header, [spread], {
      ...KEEP_ALL,
      missing: 'impute',
      types: { code: 'categorical' },
    });
    expect(categoricalSpread.columns[0][3]).toBe('9'); // mode 9 as well
    // The discriminating case: forced categorical disables outlier clipping.
    const wild: Cell[] = [...Array.from({ length: 12 }, (_, i) => String(i + 1)), '999'];
    const clippedOff = applyRecipe(['code'], [wild], {
      ...KEEP_ALL,
      clipOutliers: true,
      types: { code: 'categorical' },
    });
    expect(clippedOff.stats.clippedCells).toBe(0);
    expect(clippedOff.columns[0][12]).toBe('999');
  });
});

describe('parseRecipeFile', () => {
  it('round-trips an exported recipe and ignores unknown fields', () => {
    const exported = JSON.stringify({
      tool: 'LabML Data Studio',
      source: 'cafe-sales.csv',
      exportedAt: '2026-08-21T02:00:00Z',
      options: {
        ...DEFAULT_RECIPE,
        deriveDates: true,
        types: { date: 'date', quantity: 'categorical' },
        futureOption: 'ignored',
      },
      effect: { rowCount: 1 },
    });
    const parsed = parseRecipeFile(exported);
    expect(parsed).not.toBeNull();
    expect(parsed!.options.deriveDates).toBe(true);
    expect(parsed!.options.types).toEqual({ date: 'date', quantity: 'categorical' });
    expect(parsed!.source).toBe('cafe-sales.csv');
    expect('futureOption' in parsed!.options).toBe(false);
  });

  it('rejects payloads that are not recipes and sanitizes bad values', () => {
    expect(parseRecipeFile('not json')).toBeNull();
    expect(parseRecipeFile('{"foo": 1}')).toBeNull();
    const messy = parseRecipeFile(
      JSON.stringify({ options: { missing: 'explode', types: { a: 'alien' }, trimWhitespace: 1 } }),
    );
    expect(messy).not.toBeNull();
    expect(messy!.options.missing).toBe(DEFAULT_RECIPE.missing);
    expect(messy!.options.types).toEqual({});
    expect(messy!.options.trimWhitespace).toBe(DEFAULT_RECIPE.trimWhitespace);
  });
});

describe('formatNumber', () => {
  it('keeps numbers compact', () => {
    expect(formatNumber(16)).toBe('16');
    expect(formatNumber(12.350000000001)).toBe('12.35');
  });
});

describe('dropAnomalies', () => {
  it('drops seeded isolation-forest anomalies, deterministically', () => {
    const a: Cell[] = [];
    const b: Cell[] = [];
    for (let i = 0; i < 60; i++) {
      a.push(String(10 + (i % 5)));
      b.push(String(20 + ((i * 3) % 7)));
    }
    a.push('90');
    b.push('95');
    const options: RecipeOptions = { ...KEEP_ALL, dropAnomalies: true };
    const first = applyRecipe(['a', 'b'], [a, b], options);
    expect(first.stats.droppedAnomalyRows).toBe(1);
    expect(first.stats.rowCount).toBe(60);
    // The planted row is the one that left.
    expect(first.columns[0]).not.toContain('90');
    // Replaying is bit-identical — the forest is seeded.
    const second = applyRecipe(['a', 'b'], [a, b], options);
    expect(second.columns).toEqual(first.columns);
  });

  it('declines quietly when the data cannot support the forest', () => {
    const result = applyRecipe(
      ['a', 'w'],
      [
        ['1', '2', '3'],
        ['x', 'y', 'z'],
      ],
      { ...KEEP_ALL, dropAnomalies: true },
    );
    expect(result.stats.droppedAnomalyRows).toBe(0);
    expect(result.stats.rowCount).toBe(3);
  });
});

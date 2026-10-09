/**
 * V39 — a recipe that works column by column.
 *
 * The rule these tests defend hardest: imputing without marking destroys
 * information. A blank field is rarely blank at random, and the fact of the
 * blank is frequently predictive on its own — so the indicator must record
 * where the blanks REALLY were, before anything filled them.
 */
import { describe, expect, it } from 'vitest';
import { applyRecipe, indicatorName, strategyFor } from '@/features/data/quality/clean';
import { DEFAULT_RECIPE, parseRecipeFile, type RecipeOptions } from '@/features/data/quality/types';
import type { Cell } from '@/features/ml/data/types';

const BASE: RecipeOptions = {
  ...DEFAULT_RECIPE,
  trimWhitespace: false,
  mergeVariants: false,
  dropDuplicates: false,
  missing: 'keep',
};

/** age has blanks, ville has blanks, note is complete. */
function dataset(): { header: string[]; columns: Cell[][] } {
  return {
    header: ['age', 'ville', 'note'],
    columns: [
      ['10', '20', '', '30', '', '40'],
      ['Québec', '', 'Montréal', 'Québec', 'Québec', ''],
      ['1', '2', '3', '4', '5', '6'],
    ],
  };
}

describe('V39 — one strategy per column, not one for the whole file', () => {
  it('lets a numeric column take the median while a categorical takes a category', () => {
    const { header, columns } = dataset();
    const result = applyRecipe(header, columns, {
      ...BASE,
      columns: { age: { missing: 'median' }, ville: { missing: 'category' } },
    });
    const age = result.columns[result.header.indexOf('age')];
    const ville = result.columns[result.header.indexOf('ville')];
    // median of 10, 20, 30, 40 is 25
    expect(age).toEqual(['10', '20', '25', '30', '25', '40']);
    expect(ville).toEqual(['Québec', 'MANQUANT', 'Montréal', 'Québec', 'Québec', 'MANQUANT']);
    expect(result.stats.imputedCells).toBe(4);
  });

  it('fills with the mean when asked, and with a constant used verbatim', () => {
    const { header, columns } = dataset();
    const mean = applyRecipe(header, columns, { ...BASE, columns: { age: { missing: 'mean' } } });
    // mean of 10, 20, 30, 40 is 25 as well — assert the value, not the label
    expect(mean.columns[0]).toEqual(['10', '20', '25', '30', '25', '40']);

    const constant = applyRecipe(header, columns, {
      ...BASE,
      columns: { ville: { missing: 'constant', constant: 'inconnue' } },
    });
    expect(constant.columns[1]).toEqual([
      'Québec',
      'inconnue',
      'Montréal',
      'Québec',
      'Québec',
      'inconnue',
    ]);
  });

  it('leaves a column alone when its own step says keep, whatever the global default', () => {
    const { header, columns } = dataset();
    const result = applyRecipe(header, columns, {
      ...BASE,
      missing: 'impute', // the file-wide default would fill everything
      columns: { age: { missing: 'keep' } },
    });
    expect(result.columns[0]).toEqual(['10', '20', '', '30', '', '40']);
    // ville still followed the global default and was filled with its mode.
    expect(result.columns[1]).not.toContain('');
  });

  it('treats the global setting as a default the column may override', () => {
    // No per-column entry: exactly the pre-V39 behaviour.
    expect(strategyFor(undefined, 'impute', 'numeric')).toBe('median');
    expect(strategyFor(undefined, 'impute', 'categorical')).toBe('mode');
    expect(strategyFor(undefined, 'keep', 'numeric')).toBe('keep');
    expect(strategyFor(undefined, 'dropRows', 'numeric')).toBe('dropRows');
    // With one: the column wins.
    expect(strategyFor({ missing: 'mean' }, 'keep', 'numeric')).toBe('mean');
  });
});

describe('V39 — imputing without marking destroys information', () => {
  it('records where the blanks were BEFORE filling them', () => {
    const { header, columns } = dataset();
    const result = applyRecipe(header, columns, {
      ...BASE,
      columns: { age: { missing: 'median', indicator: true } },
    });
    const marker = indicatorName('age');
    expect(result.header).toEqual(['age', marker, 'ville', 'note']);
    // 1 exactly where the value was blank, and the value itself is now filled.
    expect(result.columns[result.header.indexOf(marker)]).toEqual(['0', '0', '1', '0', '1', '0']);
    expect(result.columns[0]).toEqual(['10', '20', '25', '30', '25', '40']);
    expect(result.stats.indicatorColumns).toEqual([marker]);
    // Marked, so nothing to warn about.
    expect(result.stats.imputedWithoutIndicator).toEqual([]);
  });

  it('names the columns it imputed WITHOUT an indicator, so the UI can say so', () => {
    const { header, columns } = dataset();
    const result = applyRecipe(header, columns, {
      ...BASE,
      columns: { age: { missing: 'median' }, ville: { missing: 'mode', indicator: true } },
    });
    expect(result.stats.imputedWithoutIndicator).toEqual(['age']);
    expect(result.stats.indicatorColumns).toEqual([indicatorName('ville')]);
  });

  it('adds no indicator for a column that had nothing missing', () => {
    const { header, columns } = dataset();
    const result = applyRecipe(header, columns, {
      ...BASE,
      columns: { note: { missing: 'median', indicator: true } },
    });
    // An all-zero column would be a constant, which is noise, not information.
    expect(result.header).toEqual(['age', 'ville', 'note']);
    expect(result.stats.indicatorColumns).toEqual([]);
  });

  it('keeps the indicator aligned when another column drops rows', () => {
    const { header, columns } = dataset();
    const result = applyRecipe(header, columns, {
      ...BASE,
      columns: {
        age: { missing: 'median', indicator: true },
        ville: { missing: 'dropRows' },
      },
    });
    // ville is blank at rows 1 and 5, so those rows go; age was blank at 2 and 4.
    expect(result.columns[result.header.indexOf('note')]).toEqual(['1', '3', '4', '5']);
    expect(result.columns[result.header.indexOf(indicatorName('age'))]).toEqual([
      '0',
      '1',
      '0',
      '1',
    ]);
    expect(result.stats.droppedByColumn).toEqual({ ville: 2 });
    expect(result.stats.droppedMissingRows).toBe(2);
  });
});

describe('V39 — refusing rather than inventing', () => {
  it('leaves blanks alone when a median has nothing to compute over', () => {
    const result = applyRecipe(['code'], [['A1', '', 'B2', '']], {
      ...BASE,
      columns: { code: { missing: 'median' } },
    });
    expect(result.columns[0]).toEqual(['A1', '', 'B2', '']);
    expect(result.stats.imputedCells).toBe(0);
    // Nothing was imputed, so there is nothing to warn about either.
    expect(result.stats.imputedWithoutIndicator).toEqual([]);
  });

  it('leaves blanks alone when constant was chosen but no value was given', () => {
    const result = applyRecipe(['ville'], [['Québec', '', 'Montréal']], {
      ...BASE,
      columns: { ville: { missing: 'constant' } },
    });
    expect(result.columns[0]).toEqual(['Québec', '', 'Montréal']);
    expect(result.stats.imputedCells).toBe(0);
  });
});

describe('V39 — the recipe stays a replayable, inspectable object', () => {
  it('round-trips per-column steps through export and import', () => {
    const options: RecipeOptions = {
      ...DEFAULT_RECIPE,
      columns: {
        age: { missing: 'median', indicator: true },
        ville: { missing: 'constant', constant: 'inconnue' },
        prix: { clipOutliers: true },
      },
    };
    const parsed = parseRecipeFile(JSON.stringify({ options, source: 'ventes.csv' }));
    expect(parsed!.options.columns).toEqual(options.columns);
    expect(parsed!.source).toBe('ventes.csv');
  });

  it('replays a recipe exported before V39, which has no columns key at all', () => {
    const old = {
      options: {
        trimWhitespace: true,
        mergeVariants: true,
        dropDuplicates: true,
        dropStructural: false,
        missing: 'impute',
        clipOutliers: false,
        deriveDates: false,
        dropAnomalies: false,
        types: { age: 'numeric' },
      },
    };
    const parsed = parseRecipeFile(JSON.stringify(old));
    expect(parsed).not.toBeNull();
    expect(parsed!.options.columns).toEqual({});
    expect(parsed!.options.types).toEqual({ age: 'numeric' });
    expect(parsed!.options.missing).toBe('impute');
  });

  it('skips a step whose strategy this version does not know, rather than guessing', () => {
    const parsed = parseRecipeFile(
      JSON.stringify({
        options: {
          columns: {
            age: { missing: 'quantum-regression' },
            ville: { missing: 'mode', indicator: true },
          },
        },
      }),
    );
    // The unknown strategy left nothing behind, so `age` gets no empty entry:
    // an empty override in the recipe would make the list of decisions lie.
    expect(parsed!.options.columns).toEqual({ ville: { missing: 'mode', indicator: true } });
  });
});

describe('V39 — clipping is a per-column decision too', () => {
  it('clips only the column that asked, leaving the other untouched', () => {
    const header = ['a', 'b'];
    const spread: Cell[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '500'];
    const result = applyRecipe(header, [[...spread], [...spread]], {
      ...BASE,
      columns: { a: { clipOutliers: true } },
    });
    expect(result.columns[0][9]).not.toBe('500');
    expect(result.columns[1][9]).toBe('500');
  });

  it('lets a column opt OUT of the global clipping', () => {
    const header = ['a', 'b'];
    const spread: Cell[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '500'];
    const result = applyRecipe(header, [[...spread], [...spread]], {
      ...BASE,
      clipOutliers: true,
      columns: { b: { clipOutliers: false } },
    });
    expect(result.columns[0][9]).not.toBe('500');
    expect(result.columns[1][9]).toBe('500');
  });
});

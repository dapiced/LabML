/**
 * V40 — the diff is evidence, where a count was only a claim.
 *
 * The test that matters most is the alignment one: a diff that pairs the wrong
 * rows after a drop is worse than no diff at all, because it reports a screen
 * full of changes that never happened.
 */
import { describe, expect, it } from 'vitest';
import { applyRecipe } from '@/features/data/quality/clean';
import { diffRecipe } from '@/features/data/quality/diff';
import { DEFAULT_RECIPE, type RecipeOptions } from '@/features/data/quality/types';
import type { Cell } from '@/features/ml/data/types';

const QUIET: RecipeOptions = {
  ...DEFAULT_RECIPE,
  trimWhitespace: false,
  mergeVariants: false,
  dropDuplicates: false,
  missing: 'keep',
};

function run(header: string[], columns: Cell[][], options: RecipeOptions) {
  const result = applyRecipe(header, columns, options);
  return {
    result,
    diff: diffRecipe(header, columns, result.header, result.columns, result.survivingRows),
  };
}

describe('V40 — which rows, which columns, which values', () => {
  it('names the cell that changed, with its value before and after', () => {
    const header = ['ville', 'age'];
    const columns: Cell[][] = [
      ['  Québec  ', 'Montréal', 'Laval'],
      ['34', '41', '29'],
    ];
    const { diff } = run(header, columns, { ...QUIET, trimWhitespace: true });
    expect(diff.changedRowCount).toBe(1);
    expect(diff.changedRows[0]).toEqual({
      sourceRow: 0,
      changes: [{ column: 'ville', before: '  Québec  ', after: 'Québec' }],
    });
    expect(diff.changedCells).toBe(1);
  });

  it('reports nothing at all when the recipe changed nothing', () => {
    const header = ['a'];
    const columns: Cell[][] = [['1', '2', '3']];
    const { diff } = run(header, columns, QUIET);
    expect(diff.changedRowCount).toBe(0);
    expect(diff.droppedRowCount).toBe(0);
    expect(diff.addedColumns).toEqual([]);
    expect(diff.removedColumns).toEqual([]);
  });

  it('attributes changes to the SOURCE row even after rows were dropped', () => {
    // Row 1 is a duplicate of row 0 and disappears. Without the surviving-row
    // map, every later row would be compared against its predecessor and the
    // diff would claim changes that never happened.
    const header = ['ville'];
    const columns: Cell[][] = [['Québec', 'Québec', '  Laval  ', 'Montréal']];
    const { result, diff } = run(header, columns, {
      ...QUIET,
      dropDuplicates: true,
      trimWhitespace: true,
    });
    expect(result.survivingRows).toEqual([0, 2, 3]);
    expect(diff.droppedRows).toEqual([1]);
    expect(diff.droppedRowCount).toBe(1);
    // Exactly one real change, and it is attributed to source row 2.
    expect(diff.changedRowCount).toBe(1);
    expect(diff.changedRows[0].sourceRow).toBe(2);
    expect(diff.changedRows[0].changes[0]).toEqual({
      column: 'ville',
      before: '  Laval  ',
      after: 'Laval',
    });
  });

  it('names the columns a recipe added and removed', () => {
    const header = ['age', 'constante'];
    const columns: Cell[][] = [
      ['34', '', '29', '41', '52', '61'],
      ['x', 'x', 'x', 'x', 'x', 'x'],
    ];
    const { diff } = run(header, columns, {
      ...QUIET,
      dropStructural: true,
      columns: { age: { missing: 'median', indicator: true } },
    });
    expect(diff.addedColumns).toEqual(['age_absent']);
    expect(diff.removedColumns).toEqual(['constante']);
  });

  it('caps the listed rows without ever capping the counts', () => {
    const header = ['ville'];
    const columns: Cell[][] = [Array.from({ length: 200 }, (_, i) => `  ville${i}  `)];
    const { diff } = run(header, columns, { ...QUIET, trimWhitespace: true });
    expect(diff.changedRowCount).toBe(200);
    expect(diff.changedRows.length).toBe(50);
    expect(diff.changedCells).toBe(200);
  });
});

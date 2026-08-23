/**
 * V40: the before/after diff — which rows, which columns, which values.
 *
 * The studio already reported counts: « 412 cells trimmed, 6 duplicate rows
 * dropped ». A count is a claim; a diff is evidence. This is what makes the
 * recipe auditable rather than merely helpful — someone can check what it did
 * instead of trusting that it did the right thing.
 *
 * The hard part is that a recipe does not only edit cells: it drops rows and
 * adds columns, so « row 7 » before and « row 7 » after are not the same row.
 * The alignment below is therefore explicit rather than positional — the
 * recipe reports which source rows survived, and every change is attributed to
 * the row it actually came from.
 */
import { isMissing } from '@/features/ml/data/infer';
import type { Cell } from '@/features/ml/data/types';

/** Rows listed in the diff — enough to audit, not enough to freeze the tab. */
export const MAX_DIFF_ROWS = 50;

export interface CellChange {
  column: string;
  before: string;
  after: string;
}

export interface RowChange {
  /** Index in the ORIGINAL dataset, so it can be found in the source file. */
  sourceRow: number;
  changes: CellChange[];
}

export interface RecipeDiff {
  /** Rows whose values changed, in source order, capped at MAX_DIFF_ROWS. */
  changedRows: RowChange[];
  /** How many rows changed in total — `changedRows` may be a prefix. */
  changedRowCount: number;
  /** Source rows the recipe removed, capped for display. */
  droppedRows: number[];
  droppedRowCount: number;
  /** Columns the recipe removed and added, by name. */
  removedColumns: string[];
  addedColumns: string[];
  /** How many individual cells changed value. */
  changedCells: number;
}

function display(value: Cell): string {
  return isMissing(value) ? '' : (value as string);
}

/**
 * Compares the dataset before and after a recipe.
 *
 * `survivingRows` maps each row of the AFTER dataset back to its index in the
 * BEFORE dataset. Without it the comparison would silently pair row 7 with a
 * different row 7 the moment anything was dropped, and report every column of
 * every subsequent row as changed — a diff that is worse than no diff.
 */
export function diffRecipe(
  beforeHeader: readonly string[],
  beforeColumns: readonly Cell[][],
  afterHeader: readonly string[],
  afterColumns: readonly Cell[][],
  survivingRows: readonly number[],
): RecipeDiff {
  const beforeIndex = new Map(beforeHeader.map((name, i) => [name, i]));
  const afterIndex = new Map(afterHeader.map((name, i) => [name, i]));

  const removedColumns = beforeHeader.filter((name) => !afterIndex.has(name));
  const addedColumns = afterHeader.filter((name) => !beforeIndex.has(name));
  const shared = beforeHeader.filter((name) => afterIndex.has(name));

  const kept = new Set(survivingRows);
  const droppedAll: number[] = [];
  const beforeRowCount = beforeColumns[0]?.length ?? 0;
  for (let row = 0; row < beforeRowCount; row++) {
    if (!kept.has(row)) droppedAll.push(row);
  }

  const changedRows: RowChange[] = [];
  let changedRowCount = 0;
  let changedCells = 0;

  for (let afterRow = 0; afterRow < survivingRows.length; afterRow++) {
    const sourceRow = survivingRows[afterRow];
    const changes: CellChange[] = [];
    for (const name of shared) {
      const before = display(beforeColumns[beforeIndex.get(name)!]?.[sourceRow] ?? null);
      const after = display(afterColumns[afterIndex.get(name)!]?.[afterRow] ?? null);
      if (before !== after) changes.push({ column: name, before, after });
    }
    if (changes.length === 0) continue;
    changedRowCount += 1;
    changedCells += changes.length;
    if (changedRows.length < MAX_DIFF_ROWS) changedRows.push({ sourceRow, changes });
  }

  return {
    changedRows,
    changedRowCount,
    droppedRows: droppedAll.slice(0, MAX_DIFF_ROWS),
    droppedRowCount: droppedAll.length,
    removedColumns,
    addedColumns,
    changedCells,
  };
}

import { inferColumnType, isMissing, parseNumber } from '@/features/ml/data/infer';
import { parseDate } from '@/features/ml/timeseries/series';
import { duplicateRowIndices, messyGroups, outlierFences } from '@/features/data/quality/checks';
import type { Cell } from '@/features/ml/data/types';
import type { CleanStats, ForcedType, RecipeOptions } from '@/features/data/quality/types';

/** Same threshold as the quality report. */
const NEAR_EMPTY_RATIO = 0.95;

/** Compact decimal formatting for imputed/clipped values. */
export function formatNumber(value: number): string {
  const rounded = Number(value.toFixed(6));
  return String(rounded);
}

function medianOf(values: Cell[]): number | null {
  const numbers: number[] = [];
  for (const value of values) {
    if (isMissing(value)) continue;
    const parsed = parseNumber(value as string);
    if (parsed !== null) numbers.push(parsed);
  }
  if (numbers.length === 0) return null;
  numbers.sort((a, b) => a - b);
  const mid = Math.floor(numbers.length / 2);
  return numbers.length % 2 === 1 ? numbers[mid] : (numbers[mid - 1] + numbers[mid]) / 2;
}

function modeOf(values: Cell[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (isMissing(value)) continue;
    const trimmed = (value as string).trim();
    counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [value, count] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function dropRows(columns: Cell[][], toDrop: Set<number>): Cell[][] {
  return columns.map((column) => column.filter((_, index) => !toDrop.has(index)));
}

/**
 * Applies the cleaning recipe to a copy of the dataset, in a fixed order:
 * trim → merge variants → drop structural columns → drop duplicate rows →
 * missing values → clip outliers. Always starts from the data it is given
 * (the caller keeps the original), so toggling options never compounds.
 */
export function applyRecipe(
  header: string[],
  source: Cell[][],
  options: RecipeOptions,
): { header: string[]; columns: Cell[][]; stats: CleanStats } {
  let outHeader = [...header];
  let columns = source.map((column) => [...column]);
  // Forced types steer every type-sensitive step; inference is the fallback.
  const typeOf = (name: string, values: Cell[]) => {
    const overrides = options.types as Partial<Record<string, ForcedType>> | undefined;
    return overrides?.[name] ?? inferColumnType(name, values);
  };
  const stats: CleanStats = {
    trimmedCells: 0,
    mergedCells: 0,
    droppedDuplicateRows: 0,
    droppedColumns: [],
    imputedCells: 0,
    droppedMissingRows: 0,
    clippedCells: 0,
    derivedColumns: [],
    rowCount: 0,
    columnCount: 0,
  };

  if (options.trimWhitespace) {
    for (const column of columns) {
      for (let r = 0; r < column.length; r++) {
        const raw = column[r];
        if (raw === null) continue;
        const trimmed = raw.trim();
        if (trimmed !== raw) {
          column[r] = trimmed;
          stats.trimmedCells += 1;
        }
      }
    }
  }

  if (options.mergeVariants) {
    for (let i = 0; i < outHeader.length; i++) {
      const type = typeOf(outHeader[i], columns[i]);
      if (type !== 'categorical' && type !== 'boolean' && type !== 'text') continue;
      for (const group of messyGroups(columns[i])) {
        const variants = new Set(group.variants);
        const column = columns[i];
        for (let r = 0; r < column.length; r++) {
          const raw = column[r];
          if (raw === null || raw === group.canonical) continue;
          if (
            variants.has(raw) ||
            raw.trim().toLowerCase() === group.canonical.trim().toLowerCase()
          ) {
            column[r] = group.canonical;
            stats.mergedCells += 1;
          }
        }
      }
    }
  }

  if (options.deriveDates) {
    const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const baseCount = outHeader.length;
    for (let i = 0; i < baseCount; i++) {
      if (typeOf(outHeader[i], columns[i]) !== 'date') continue;
      const year: Cell[] = [];
      const month: Cell[] = [];
      const weekday: Cell[] = [];
      for (const cell of columns[i]) {
        const timestamp = isMissing(cell) ? null : parseDate(cell as string);
        if (timestamp === null) {
          year.push(null);
          month.push(null);
          weekday.push(null);
          continue;
        }
        const date = new Date(timestamp);
        year.push(String(date.getUTCFullYear()));
        month.push(String(date.getUTCMonth() + 1).padStart(2, '0'));
        weekday.push(WEEKDAYS[date.getUTCDay()]);
      }
      const derived = [`${outHeader[i]}_year`, `${outHeader[i]}_month`, `${outHeader[i]}_weekday`];
      outHeader = [...outHeader, ...derived];
      columns.push(year, month, weekday);
      stats.derivedColumns.push(...derived);
    }
  }

  if (options.dropStructural) {
    const keep: number[] = [];
    for (let i = 0; i < outHeader.length; i++) {
      const values = columns[i];
      const rowCount = values.length;
      let missing = 0;
      const distinct = new Set<string>();
      for (const value of values) {
        if (isMissing(value)) missing += 1;
        else distinct.add((value as string).trim());
      }
      const nearEmpty = rowCount > 0 && missing / rowCount >= NEAR_EMPTY_RATIO;
      const constant = distinct.size <= 1;
      if (nearEmpty || constant) stats.droppedColumns.push(outHeader[i]);
      else keep.push(i);
    }
    outHeader = keep.map((i) => outHeader[i]);
    columns = keep.map((i) => columns[i]);
  }

  if (options.dropDuplicates && columns.length > 0) {
    const duplicates = new Set(duplicateRowIndices(columns, columns[0].length));
    stats.droppedDuplicateRows = duplicates.size;
    if (duplicates.size > 0) columns = dropRows(columns, duplicates);
  }

  if (options.missing === 'dropRows' && columns.length > 0) {
    const toDrop = new Set<number>();
    for (let r = 0; r < columns[0].length; r++) {
      if (columns.some((column) => isMissing(column[r]))) toDrop.add(r);
    }
    stats.droppedMissingRows = toDrop.size;
    if (toDrop.size > 0) columns = dropRows(columns, toDrop);
  } else if (options.missing === 'impute') {
    for (let i = 0; i < outHeader.length; i++) {
      const column = columns[i];
      const type = typeOf(outHeader[i], column);
      const median = type === 'numeric' ? medianOf(column) : null;
      const replacement = median !== null ? formatNumber(median) : modeOf(column);
      if (replacement === null) continue;
      for (let r = 0; r < column.length; r++) {
        if (isMissing(column[r])) {
          column[r] = replacement;
          stats.imputedCells += 1;
        }
      }
    }
  }

  if (options.clipOutliers) {
    for (let i = 0; i < outHeader.length; i++) {
      const column = columns[i];
      if (typeOf(outHeader[i], column) !== 'numeric') continue;
      const fences = outlierFences(column);
      if (!fences) continue;
      for (let r = 0; r < column.length; r++) {
        const raw = column[r];
        if (raw === null || isMissing(raw)) continue;
        const parsed = parseNumber(raw);
        if (parsed === null) continue;
        if (parsed < fences.low) {
          column[r] = formatNumber(fences.low);
          stats.clippedCells += 1;
        } else if (parsed > fences.high) {
          column[r] = formatNumber(fences.high);
          stats.clippedCells += 1;
        }
      }
    }
  }

  stats.rowCount = columns[0]?.length ?? 0;
  stats.columnCount = outHeader.length;
  return { header: outHeader, columns, stats };
}

import { ANOMALY_THRESHOLD, isolationScores } from '@/features/data/quality/isolation';
import { inferColumnType, isMissing, parseNumber } from '@/features/ml/data/infer';
import { parseDate } from '@/features/ml/timeseries/series';
import { duplicateRowIndices, messyGroups, outlierFences } from '@/features/data/quality/checks';
import type { Cell } from '@/features/ml/data/types';
import {
  MISSING_CATEGORY,
  type CleanStats,
  type ColumnStep,
  type ForcedType,
  type MissingStrategy,
  type RecipeOptions,
} from '@/features/data/quality/types';

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

function meanOf(values: Cell[]): number | null {
  let sum = 0;
  let count = 0;
  for (const value of values) {
    if (isMissing(value)) continue;
    const parsed = parseNumber(value as string);
    if (parsed !== null) {
      sum += parsed;
      count += 1;
    }
  }
  return count === 0 ? null : sum / count;
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

/**
 * V39: the strategy that actually applies to one column — its own override if
 * it has one, otherwise the file-wide default translated into the per-column
 * vocabulary. `impute` was never a strategy, only an instruction to pick one;
 * it becomes the median on a numeric column and the mode everywhere else,
 * which is exactly what the global path did before V39.
 */
export function strategyFor(
  step: ColumnStep | undefined,
  globalMissing: RecipeOptions['missing'],
  type: string,
): MissingStrategy {
  if (step?.missing !== undefined) return step.missing;
  if (globalMissing === 'keep') return 'keep';
  if (globalMissing === 'dropRows') return 'dropRows';
  return type === 'numeric' ? 'median' : 'mode';
}

/** V39: the name of the indicator column added beside `column`. */
export function indicatorName(column: string): string {
  return `${column}_absent`;
}

/**
 * V39: the single value one strategy fills a column's blanks with, or null
 * when the column cannot support it — a median over a column holding no
 * parseable number returns nothing, and returning nothing is the honest
 * answer. `constant` is used verbatim, including an empty string, because the
 * user typed it on purpose.
 */
function fillValueFor(
  strategy: MissingStrategy,
  step: ColumnStep | undefined,
  column: Cell[],
): string | null {
  switch (strategy) {
    case 'median': {
      const median = medianOf(column);
      return median === null ? null : formatNumber(median);
    }
    case 'mean': {
      const mean = meanOf(column);
      return mean === null ? null : formatNumber(mean);
    }
    case 'mode':
      return modeOf(column);
    case 'constant':
      return step?.constant ?? null;
    case 'category':
      return MISSING_CATEGORY;
    default:
      return null;
  }
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
    indicatorColumns: [],
    imputedWithoutIndicator: [],
    droppedByColumn: {},
    droppedMissingRows: 0,
    clippedCells: 0,
    derivedColumns: [],
    droppedAnomalyRows: 0,
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

  // V39: missing values, column by column. Two passes, and the order between
  // them is the whole point: every indicator is written BEFORE any blank is
  // filled, so an indicator always records where the blanks really were —
  // never where they were left after some other column's rule ran.
  if (columns.length > 0) {
    const indicators: { at: number; name: string; values: Cell[] }[] = [];
    for (let i = 0; i < outHeader.length; i++) {
      const step = options.columns[outHeader[i]];
      if (step?.indicator !== true) continue;
      const column = columns[i];
      if (!column.some((value) => isMissing(value))) continue; // nothing to mark
      indicators.push({
        at: i,
        name: indicatorName(outHeader[i]),
        values: column.map((value) => (isMissing(value) ? '1' : '0')),
      });
    }

    // Pass 2: rows to drop, gathered across every column that asked, then
    // applied once — dropping per column in sequence would shift the indices
    // the next column is about to use.
    const toDrop = new Set<number>();
    const dropSources: { column: string; rows: number[] }[] = [];
    for (let i = 0; i < outHeader.length; i++) {
      const name = outHeader[i];
      const column = columns[i];
      if (
        strategyFor(options.columns[name], options.missing, typeOf(name, column)) !== 'dropRows'
      ) {
        continue;
      }
      const rows: number[] = [];
      for (let r = 0; r < column.length; r++) {
        if (isMissing(column[r])) {
          rows.push(r);
          toDrop.add(r);
        }
      }
      if (rows.length > 0) dropSources.push({ column: name, rows });
    }

    // Pass 3: fill what stays. Computed on the pre-drop column, which is the
    // same set of values the report described.
    for (let i = 0; i < outHeader.length; i++) {
      const name = outHeader[i];
      const column = columns[i];
      const type = typeOf(name, column);
      const step = options.columns[name];
      const strategy = strategyFor(step, options.missing, type);
      if (strategy === 'keep' || strategy === 'dropRows') continue;

      const replacement = fillValueFor(strategy, step, column);
      // A refusal by name rather than a silent no-op: a mean over a column
      // with no parseable number has nothing to return, so the blanks stay
      // blank and the column is not counted as imputed.
      if (replacement === null) continue;

      let filled = 0;
      for (let r = 0; r < column.length; r++) {
        if (isMissing(column[r])) {
          column[r] = replacement;
          filled += 1;
        }
      }
      if (filled === 0) continue;
      stats.imputedCells += filled;
      if (step?.indicator !== true) stats.imputedWithoutIndicator.push(name);
    }

    if (toDrop.size > 0) {
      stats.droppedMissingRows = toDrop.size;
      for (const source of dropSources) {
        stats.droppedByColumn[source.column] = source.rows.length;
      }
      columns = dropRows(columns, toDrop);
      for (const indicator of indicators) {
        indicator.values = indicator.values.filter((_, index) => !toDrop.has(index));
      }
    }

    // Indicators are spliced in right after the column they describe, walking
    // from the right so the earlier insertion points stay valid.
    for (const indicator of [...indicators].sort((a, b) => b.at - a.at)) {
      outHeader.splice(indicator.at + 1, 0, indicator.name);
      columns.splice(indicator.at + 1, 0, indicator.values);
      stats.indicatorColumns.unshift(indicator.name);
    }
  }

  // V39: clipping is a per-column decision too — the global flag is the
  // default, and a column may opt in or out of it on its own.
  for (let i = 0; i < outHeader.length; i++) {
    const column = columns[i];
    const clip = options.columns[outHeader[i]]?.clipOutliers ?? options.clipOutliers;
    if (!clip) continue;
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

  // Last step, on the CLEANED data: the seeded isolation forest sees complete
  // numeric rows (imputed, clipped) and flags multivariate anomalies — the odd
  // COMBINATIONS the univariate Tukey fences cannot see. Seeded, so replaying
  // the recipe on the same file drops the same rows, always.
  if (options.dropAnomalies) {
    const anomalies = isolationScores(outHeader, columns);
    if (anomalies) {
      const keep: number[] = [];
      for (let r = 0; r < anomalies.scores.length; r++) {
        if (anomalies.scores[r] > ANOMALY_THRESHOLD) stats.droppedAnomalyRows += 1;
        else keep.push(r);
      }
      if (stats.droppedAnomalyRows > 0) {
        columns = columns.map((column) => keep.map((r) => column[r]));
      }
    }
  }

  stats.rowCount = columns[0]?.length ?? 0;
  stats.columnCount = outHeader.length;
  return { header: outHeader, columns, stats };
}

import { checkValidity, invalidCellCount } from '@/features/data/quality/validity';
import { checkConsistency, inconsistentRowCount } from '@/features/data/quality/consistency';
import { inferColumnType, isMissing, parseNumber } from '@/features/ml/data/infer';
import type { Cell, ColumnType } from '@/features/ml/data/types';
import type {
  MessyColumn,
  MessyGroup,
  MissingColumn,
  OutlierColumn,
  QualityReport,
  StructuralIssue,
} from '@/features/data/quality/types';

/** Missing ratio above which a column counts as near-empty (same as the ML Lab). */
const NEAR_EMPTY_RATIO = 0.95;
/** Minimum numeric values before outlier fences are meaningful. */
const MIN_OUTLIER_SAMPLE = 8;
/** Distinct spellings shown per messy group. */
const MAX_VARIANTS_SHOWN = 6;
/** Messy groups shown per column. */
const MAX_GROUPS_SHOWN = 5;

/** Linear-interpolated quantile of an ascending-sorted array. */
export function quantileSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const position = (sorted.length - 1) * q;
  const base = Math.floor(position);
  const rest = position - base;
  const next = sorted[base + 1];
  return next === undefined ? sorted[base] : sorted[base] + rest * (next - sorted[base]);
}

/** Tukey fences [Q1 − 1.5·IQR, Q3 + 1.5·IQR] of a numeric column, or null. */
export function outlierFences(values: Cell[]): { low: number; high: number } | null {
  const numbers: number[] = [];
  for (const value of values) {
    if (isMissing(value)) continue;
    const parsed = parseNumber(value as string);
    if (parsed !== null) numbers.push(parsed);
  }
  if (numbers.length < MIN_OUTLIER_SAMPLE) return null;
  numbers.sort((a, b) => a - b);
  const q1 = quantileSorted(numbers, 0.25);
  const q3 = quantileSorted(numbers, 0.75);
  const iqr = q3 - q1;
  if (iqr <= 0) return null;
  return { low: q1 - 1.5 * iqr, high: q3 + 1.5 * iqr };
}

function countOutliers(values: Cell[], low: number, high: number): number {
  let count = 0;
  for (const value of values) {
    if (isMissing(value)) continue;
    const parsed = parseNumber(value as string);
    if (parsed !== null && (parsed < low || parsed > high)) count += 1;
  }
  return count;
}

/**
 * Case/whitespace variants inside one column: cells whose trimmed+lowercased
 * form collides are grouped; the most frequent raw spelling is the canonical
 * one (ties broken alphabetically for determinism).
 */
export function messyGroups(values: Cell[]): MessyGroup[] {
  const byKey = new Map<string, Map<string, number>>();
  for (const value of values) {
    if (isMissing(value)) continue;
    const raw = value as string;
    const key = raw.trim().toLowerCase();
    let forms = byKey.get(key);
    if (!forms) {
      forms = new Map();
      byKey.set(key, forms);
    }
    forms.set(raw, (forms.get(raw) ?? 0) + 1);
  }

  const groups: MessyGroup[] = [];
  for (const forms of byKey.values()) {
    if (forms.size < 2) continue;
    const ranked = [...forms.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const canonical = ranked[0][0];
    let cellCount = 0;
    for (const [form, count] of ranked) {
      if (form !== canonical) cellCount += count;
    }
    groups.push({
      canonical,
      variants: ranked.map(([form]) => form).slice(0, MAX_VARIANTS_SHOWN),
      cellCount,
    });
  }
  return groups.sort((a, b) => b.cellCount - a.cellCount || a.canonical.localeCompare(b.canonical));
}

/** Row indices that repeat an earlier row exactly (raw cells compared). */
export function duplicateRowIndices(columns: Cell[][], rowCount: number): number[] {
  const seen = new Set<string>();
  const duplicates: number[] = [];
  for (let r = 0; r < rowCount; r++) {
    let key = '';
    for (const column of columns) {
      key += (column[r] ?? '\u0000') + '\u0001';
    }
    if (seen.has(key)) duplicates.push(r);
    else seen.add(key);
  }
  return duplicates;
}

function missingCountOf(values: Cell[]): number {
  let count = 0;
  for (const value of values) if (isMissing(value)) count += 1;
  return count;
}

/**
 * V40: the score, decomposed.
 *
 * The number was asserted before: 62 out of 100, with nothing saying why. Each
 * part now carries its own weight, the ratio that drove it, and the points it
 * actually cost — so the score is explained by its parts instead of being
 * announced. The arithmetic is unchanged apart from the new validity part; a
 * file with no validity findings scores exactly what it scored before V40.
 */
export type ScorePart = 'missing' | 'duplicates' | 'messy' | 'outliers' | 'structural' | 'validity';

export interface ScoreBreakdown {
  part: ScorePart;
  /** The most this part can ever cost. */
  weight: number;
  /** What it cost here, rounded to one decimal. */
  penalty: number;
  /** The ratio that drove it — absent for the structural count. */
  ratio?: number;
  /** The raw count behind the ratio, for the plain-language line. */
  count: number;
}

/** Each ratio saturates at 12.5% (×8) so a modest amount of dirt is visible. */
const SATURATION = 8;
/** Sum of every weight below. Above 100 on purpose — see the validity part. */
export const TOTAL_WEIGHT = 105;

export function scoreBreakdown(
  report: Omit<QualityReport, 'score' | 'breakdown'>,
  invalidCells = 0,
): ScoreBreakdown[] {
  const cells = Math.max(1, report.cellCount);
  const rows = Math.max(1, report.rowCount);
  const saturate = (ratio: number) => Math.min(1, ratio * SATURATION);
  const round = (value: number) => Math.round(value * 10) / 10;
  const ratioPart = (
    part: ScorePart,
    weight: number,
    count: number,
    total: number,
  ): ScoreBreakdown => {
    const ratio = count / total;
    return { part, weight, penalty: round(weight * saturate(ratio)), ratio, count };
  };
  return [
    ratioPart('missing', 35, report.missingCells, cells),
    ratioPart('duplicates', 20, report.duplicateRows, rows),
    ratioPart('messy', 20, report.messyCells, cells),
    ratioPart('outliers', 15, report.outlierCells, cells),
    {
      part: 'structural',
      weight: 10,
      penalty: round(Math.min(10, 2.5 * report.structural.length)),
      count: report.structural.length,
    },
    // V40: validity is a NEW dimension, so it brings its own 5 points rather
    // than taking them from an existing part. The weights therefore sum to 105,
    // not 100, and that is deliberate: redistributing would have quietly
    // changed what every previously published score meant. A file with no
    // validity findings scores exactly what it scored before V40 — the total
    // still floors at 0, which the previous formula could already reach.
    ratioPart('validity', 5, invalidCells, cells),
  ];
}

/**
 * Deterministic 0–100 score, now the sum of its published parts rather than a
 * separate formula that could drift away from them.
 */
export function qualityScore(
  report: Omit<QualityReport, 'score' | 'breakdown'>,
  invalidCells = 0,
): number {
  const penalty = scoreBreakdown(report, invalidCells).reduce(
    (total, part) => total + part.penalty,
    0,
  );
  return Math.max(0, Math.round(100 - penalty));
}

export function buildQualityReport(header: string[], columns: Cell[][]): QualityReport {
  const rowCount = columns[0]?.length ?? 0;
  const columnCount = header.length;
  const cellCount = rowCount * columnCount;

  const types: ColumnType[] = header.map((name, i) => inferColumnType(name, columns[i]));

  const missingColumns: MissingColumn[] = [];
  let missingCells = 0;
  const messyColumns: MessyColumn[] = [];
  let messyCells = 0;
  const outlierColumns: OutlierColumn[] = [];
  let outlierCells = 0;
  const structural: StructuralIssue[] = [];

  for (let i = 0; i < header.length; i++) {
    const values = columns[i];
    const missing = missingCountOf(values);
    missingCells += missing;
    if (missing > 0) {
      missingColumns.push({
        column: header[i],
        count: missing,
        ratio: rowCount > 0 ? missing / rowCount : 0,
      });
    }

    if (types[i] === 'categorical' || types[i] === 'boolean' || types[i] === 'text') {
      const groups = messyGroups(values);
      if (groups.length > 0) {
        const cells = groups.reduce((acc, group) => acc + group.cellCount, 0);
        messyCells += cells;
        messyColumns.push({
          column: header[i],
          groups: groups.slice(0, MAX_GROUPS_SHOWN),
          cellCount: cells,
        });
      }
    }

    if (types[i] === 'numeric') {
      const fences = outlierFences(values);
      if (fences) {
        const count = countOutliers(values, fences.low, fences.high);
        if (count > 0) {
          outlierCells += count;
          outlierColumns.push({ column: header[i], count, ...fences });
        }
      }
    }

    const distinct = new Set<string>();
    for (const value of values) {
      if (!isMissing(value)) distinct.add((value as string).trim());
    }
    if (rowCount > 0 && missing / rowCount >= NEAR_EMPTY_RATIO) {
      structural.push({ column: header[i], kind: 'nearEmpty' });
    } else if (distinct.size <= 1) {
      structural.push({ column: header[i], kind: 'constant' });
    } else if (types[i] === 'id') {
      structural.push({ column: header[i], kind: 'id' });
    }
  }

  missingColumns.sort((a, b) => b.count - a.count || a.column.localeCompare(b.column));
  messyColumns.sort((a, b) => b.cellCount - a.cellCount || a.column.localeCompare(b.column));
  outlierColumns.sort((a, b) => b.count - a.count || a.column.localeCompare(b.column));

  // V40: the two families of impossible data — one column at a time, then
  // rows where two columns contradict each other.
  const validity = checkValidity(header, columns);
  const invalidCells = invalidCellCount(validity);
  const consistency = checkConsistency(header, columns);
  const inconsistentRows = inconsistentRowCount(consistency);

  const partial: Omit<QualityReport, 'score' | 'breakdown'> = {
    rowCount,
    columnCount,
    cellCount,
    missingCells,
    missingColumns,
    duplicateRows: duplicateRowIndices(columns, rowCount).length,
    messyColumns,
    messyCells,
    outlierColumns,
    outlierCells,
    structural,
    validity,
    invalidCells,
    consistency,
    inconsistentRows,
  };
  return {
    ...partial,
    score: qualityScore(partial, invalidCells),
    breakdown: scoreBreakdown(partial, invalidCells),
  };
}

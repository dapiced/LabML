/**
 * V40: the reference profile — drift without the original file.
 *
 * V11 compares two datasets that are both open in the tab. That answers « has
 * this month's export drifted from last month's? » only for as long as you
 * still hold last month's file. A profile is the same idea as V22's model
 * manifest applied to data: a small, exportable, replayable description of what
 * the reference LOOKED like, so a new file can be checked against a snapshot
 * taken months ago and long since deleted.
 *
 * What it deliberately is not: a copy of the data. It stores bin EDGES and
 * SHARES, never rows — a profile of a payroll file reveals the shape of the
 * salary distribution, not anybody's salary. That is what makes it safe to
 * commit next to the code it describes, which is the whole point of having it.
 */
import { isMissing, inferColumnType, parseNumber } from '@/features/ml/data/infer';
import {
  psi,
  severityOf,
  type ColumnDrift,
  type DriftSeverity,
} from '@/features/data/quality/drift';
import type { Cell } from '@/features/ml/data/types';

/** Same bin count as V11, so a profile and a live comparison agree. */
const NUMERIC_BINS = 10;
/** Categories kept by name; the rest collapse into OTHER. */
const TOP_CATEGORIES = 12;
export const PROFILE_FORMAT = 'labml-data-profile/1';

export interface NumericProfile {
  kind: 'numeric';
  column: string;
  missingRatio: number;
  mean: number;
  /** Quantile edges of the reference — the bins a new file is scored into. */
  edges: number[];
  /** Reference share per bin, length edges.length + 1. */
  shares: number[];
}

export interface CategoricalProfile {
  kind: 'categorical';
  column: string;
  missingRatio: number;
  /** Share per named category, plus OTHER — never the rows themselves. */
  shares: Record<string, number>;
}

export type ColumnProfileEntry = NumericProfile | CategoricalProfile;

export interface DataProfile {
  format: typeof PROFILE_FORMAT;
  source: string;
  createdAt: string;
  rowCount: number;
  columns: ColumnProfileEntry[];
}

const OTHER = '__other__';

function numbersOf(values: Cell[]): number[] {
  const numbers: number[] = [];
  for (const value of values) {
    if (isMissing(value)) continue;
    const parsed = parseNumber((value as string).trim());
    if (parsed !== null) numbers.push(parsed);
  }
  return numbers;
}

function missingRatio(values: Cell[]): number {
  if (values.length === 0) return 0;
  let missing = 0;
  for (const value of values) if (isMissing(value)) missing += 1;
  return missing / values.length;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return low === high ? sorted[low] : sorted[low] + (position - low) * (sorted[high] - sorted[low]);
}

function sharesOverEdges(edges: number[], numbers: number[]): number[] {
  const counts = new Array<number>(edges.length + 1).fill(0);
  for (const value of numbers) {
    let bin = 0;
    while (bin < edges.length && value > edges[bin]) bin += 1;
    counts[bin] += 1;
  }
  return counts.map((count) => (numbers.length > 0 ? count / numbers.length : 0));
}

function categoryShares(values: Cell[]): { shares: Record<string, number>; names: string[] } {
  const counts = new Map<string, number>();
  let total = 0;
  for (const value of values) {
    if (isMissing(value)) continue;
    const key = (value as string).trim();
    counts.set(key, (counts.get(key) ?? 0) + 1);
    total += 1;
  }
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TOP_CATEGORIES);
  const shares: Record<string, number> = {};
  let named = 0;
  for (const [name, count] of top) {
    shares[name] = total > 0 ? count / total : 0;
    named += count;
  }
  shares[OTHER] = total > 0 ? (total - named) / total : 0;
  return { shares, names: top.map(([name]) => name) };
}

/** Builds the exportable profile of a dataset. */
export function buildProfile(
  header: readonly string[],
  columns: Cell[][],
  source: string,
  now = new Date(),
): DataProfile {
  const entries: ColumnProfileEntry[] = [];
  for (let i = 0; i < header.length; i++) {
    const name = header[i];
    const values = columns[i] ?? [];
    const type = inferColumnType(name, values);
    if (type === 'numeric') {
      const sorted = numbersOf(values).sort((a, b) => a - b);
      const edges: number[] = [];
      for (let b = 1; b < NUMERIC_BINS; b++) {
        const edge = quantile(sorted, b / NUMERIC_BINS);
        if (edges.length === 0 || edge > edges[edges.length - 1]) edges.push(edge);
      }
      entries.push({
        kind: 'numeric',
        column: name,
        missingRatio: missingRatio(values),
        mean: sorted.length > 0 ? sorted.reduce((a, v) => a + v, 0) / sorted.length : 0,
        edges,
        shares: sharesOverEdges(edges, sorted),
      });
      continue;
    }
    // Text and dates are profiled as categories: a share table is meaningful
    // for both, and PSI over shares is the same computation either way.
    entries.push({
      kind: 'categorical',
      column: name,
      missingRatio: missingRatio(values),
      shares: categoryShares(values).shares,
    });
  }
  return {
    format: PROFILE_FORMAT,
    source,
    createdAt: now.toISOString(),
    rowCount: columns[0]?.length ?? 0,
    columns: entries,
  };
}

export interface ProfileComparison {
  /** Per-column drift against the stored profile, worst first. */
  columns: ColumnDrift[];
  /** Columns the profile describes that the new file does not have. */
  missingColumns: string[];
  /** Columns the new file has that the profile does not describe. */
  newColumns: string[];
  worst: DriftSeverity;
}

/**
 * Scores a new file against a stored profile. Every number is computed the way
 * V11 computes it, so a profile comparison and a live two-file comparison give
 * the same PSI for the same pair of datasets.
 */
export function compareToProfile(
  profile: DataProfile,
  header: readonly string[],
  columns: Cell[][],
): ProfileComparison {
  const index = new Map(header.map((name, i) => [name, i]));
  const described = new Set(profile.columns.map((entry) => entry.column));
  const drifts: ColumnDrift[] = [];
  const missingColumns: string[] = [];

  for (const entry of profile.columns) {
    const at = index.get(entry.column);
    if (at === undefined) {
      missingColumns.push(entry.column);
      continue;
    }
    const values = columns[at] ?? [];
    if (entry.kind === 'numeric') {
      const numbers = numbersOf(values);
      const value =
        numbers.length === 0 ? 0 : psi(entry.shares, sharesOverEdges(entry.edges, numbers));
      drifts.push({
        column: entry.column,
        kind: 'numeric',
        psi: value,
        severity: severityOf(value),
        refMissingRatio: entry.missingRatio,
        newMissingRatio: missingRatio(values),
        refMean: entry.mean,
        newMean: numbers.length > 0 ? numbers.reduce((a, v) => a + v, 0) / numbers.length : 0,
      });
      continue;
    }
    // Categorical: score the new file into the profile's own buckets, so a
    // category the reference never saw lands in OTHER rather than inventing
    // a bucket the reference has no share for.
    const names = Object.keys(entry.shares).filter((name) => name !== OTHER);
    const nameSet = new Set(names);
    const counts = new Map<string, number>(names.map((name) => [name, 0]));
    counts.set(OTHER, 0);
    let total = 0;
    for (const value of values) {
      if (isMissing(value)) continue;
      const key = (value as string).trim();
      const bucket = nameSet.has(key) ? key : OTHER;
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
      total += 1;
    }
    const order = [...names, OTHER];
    const referenceShares = order.map((name) => entry.shares[name] ?? 0);
    const newShares = order.map((name) => (total > 0 ? (counts.get(name) ?? 0) / total : 0));
    const value = total === 0 ? 0 : psi(referenceShares, newShares);
    drifts.push({
      column: entry.column,
      kind: 'categorical',
      psi: value,
      severity: severityOf(value),
      refMissingRatio: entry.missingRatio,
      newMissingRatio: missingRatio(values),
    });
  }

  const newColumns = header.filter((name) => !described.has(name));
  drifts.sort((a, b) => b.psi - a.psi || a.column.localeCompare(b.column));
  // The worst severity present, using V11's own three levels. Ordered
  // explicitly rather than by array position, so adding a level later cannot
  // silently make this return the wrong one.
  const worst: DriftSeverity = drifts.some((d) => d.severity === 'strong')
    ? 'strong'
    : drifts.some((d) => d.severity === 'moderate')
      ? 'moderate'
      : 'stable';
  return { columns: drifts, missingColumns, newColumns, worst };
}

/**
 * Parses an exported profile. Strict on the format marker and on the shapes it
 * needs — a profile that cannot be trusted to describe anything is refused by
 * name rather than half-applied.
 */
export function parseProfile(json: string): DataProfile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (record.format !== PROFILE_FORMAT) return null;
  if (!Array.isArray(record.columns)) return null;

  const columns: ColumnProfileEntry[] = [];
  for (const raw of record.columns) {
    if (typeof raw !== 'object' || raw === null) continue;
    const entry = raw as Record<string, unknown>;
    if (typeof entry.column !== 'string') continue;
    const missing = typeof entry.missingRatio === 'number' ? entry.missingRatio : 0;
    if (entry.kind === 'numeric' && Array.isArray(entry.edges) && Array.isArray(entry.shares)) {
      columns.push({
        kind: 'numeric',
        column: entry.column,
        missingRatio: missing,
        mean: typeof entry.mean === 'number' ? entry.mean : 0,
        edges: entry.edges.filter((value): value is number => typeof value === 'number'),
        shares: entry.shares.filter((value): value is number => typeof value === 'number'),
      });
    } else if (entry.kind === 'categorical' && typeof entry.shares === 'object' && entry.shares) {
      const shares: Record<string, number> = {};
      for (const [name, share] of Object.entries(entry.shares as Record<string, unknown>)) {
        if (typeof share === 'number') shares[name] = share;
      }
      columns.push({ kind: 'categorical', column: entry.column, missingRatio: missing, shares });
    }
  }
  if (columns.length === 0) return null;
  return {
    format: PROFILE_FORMAT,
    source: typeof record.source === 'string' ? record.source : '',
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : '',
    rowCount: typeof record.rowCount === 'number' ? record.rowCount : 0,
    columns,
  };
}

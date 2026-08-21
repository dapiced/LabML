/**
 * Data drift between a REFERENCE dataset and a NEW one — the MLOps gesture of
 * checking that a fresh batch still looks like what a model was trained on.
 * Schema diff, Population Stability Index per shared column (bins built from
 * the reference), new/vanished categories, missing-rate shifts. Pure and
 * deterministic; the conventional PSI thresholds 0.1 / 0.25 grade severity.
 */
import { inferColumnType, isMissing, parseNumber } from '@/features/ml/data/infer';
import { quantileSorted } from '@/features/data/quality/checks';
import type { Cell, ColumnType } from '@/features/ml/data/types';

const NUMERIC_BINS = 10;
const TOP_CATEGORIES = 10;
/** Laplace-style smoothing so an empty bin never yields an infinite PSI. */
const EPSILON = 1e-4;

export type DriftSeverity = 'stable' | 'moderate' | 'strong';

export interface ColumnDrift {
  column: string;
  kind: 'numeric' | 'categorical';
  psi: number;
  severity: DriftSeverity;
  refMissingRatio: number;
  newMissingRatio: number;
  /** Numeric columns only. */
  refMean?: number;
  newMean?: number;
  /** Categorical columns only, capped for display. */
  newCategories?: string[];
  goneCategories?: string[];
}

export interface DriftReport {
  refRows: number;
  newRows: number;
  schema: {
    added: string[];
    removed: string[];
    typeChanged: { column: string; from: ColumnType; to: ColumnType }[];
  };
  /** Shared columns, most drifted first. */
  columns: ColumnDrift[];
  driftedColumns: number;
  severity: DriftSeverity;
}

export function severityOf(psi: number): DriftSeverity {
  if (psi < 0.1) return 'stable';
  if (psi < 0.25) return 'moderate';
  return 'strong';
}

/** PSI between two discrete distributions given as aligned probability arrays. */
export function psi(reference: number[], current: number[]): number {
  let total = 0;
  for (let i = 0; i < reference.length; i++) {
    const p = Math.max(reference[i], EPSILON);
    const q = Math.max(current[i] ?? 0, EPSILON);
    total += (q - p) * Math.log(q / p);
  }
  return total;
}

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

/** Shares over bins whose edges are the reference's quantiles (open-ended tails). */
function numericShares(edges: number[], numbers: number[]): number[] {
  const counts = new Array<number>(edges.length + 1).fill(0);
  for (const value of numbers) {
    let bin = 0;
    while (bin < edges.length && value > edges[bin]) bin += 1;
    counts[bin] += 1;
  }
  return counts.map((count) => (numbers.length > 0 ? count / numbers.length : 0));
}

function numericDrift(column: string, ref: Cell[], next: Cell[]): ColumnDrift {
  const refNumbers = numbersOf(ref).sort((a, b) => a - b);
  const newNumbers = numbersOf(next);
  const edges: number[] = [];
  for (let b = 1; b < NUMERIC_BINS; b++) {
    const edge = quantileSorted(refNumbers, b / NUMERIC_BINS);
    if (edges.length === 0 || edge > edges[edges.length - 1]) edges.push(edge);
  }
  const value =
    refNumbers.length === 0 || newNumbers.length === 0
      ? 0
      : psi(numericShares(edges, refNumbers), numericShares(edges, newNumbers));
  const mean = (numbers: number[]) =>
    numbers.length > 0 ? numbers.reduce((a, v) => a + v, 0) / numbers.length : 0;
  return {
    column,
    kind: 'numeric',
    psi: value,
    severity: severityOf(value),
    refMissingRatio: missingRatio(ref),
    newMissingRatio: missingRatio(next),
    refMean: mean(refNumbers),
    newMean: mean(newNumbers),
  };
}

function categoryCounts(values: Cell[]): { counts: Map<string, number>; total: number } {
  const counts = new Map<string, number>();
  let total = 0;
  for (const value of values) {
    if (isMissing(value)) continue;
    const key = (value as string).trim();
    counts.set(key, (counts.get(key) ?? 0) + 1);
    total += 1;
  }
  return { counts, total };
}

function categoricalDrift(column: string, ref: Cell[], next: Cell[]): ColumnDrift {
  const refCounts = categoryCounts(ref);
  const newCounts = categoryCounts(next);
  // Buckets: the reference's top categories, plus OTHER for everything else.
  const top = [...refCounts.counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TOP_CATEGORIES)
    .map(([category]) => category);
  const share = ({ counts, total }: typeof refCounts): number[] => {
    if (total === 0) return new Array<number>(top.length + 1).fill(0);
    let inTop = 0;
    const shares = top.map((category) => {
      const count = counts.get(category) ?? 0;
      inTop += count;
      return count / total;
    });
    shares.push((total - inTop) / total);
    return shares;
  };
  const value =
    refCounts.total === 0 || newCounts.total === 0 ? 0 : psi(share(refCounts), share(newCounts));

  const newCategories = [...newCounts.counts.keys()]
    .filter((category) => !refCounts.counts.has(category))
    .sort()
    .slice(0, 6);
  const goneCategories = [...refCounts.counts.keys()]
    .filter((category) => !newCounts.counts.has(category))
    .sort()
    .slice(0, 6);

  return {
    column,
    kind: 'categorical',
    psi: value,
    severity: severityOf(value),
    refMissingRatio: missingRatio(ref),
    newMissingRatio: missingRatio(next),
    newCategories,
    goneCategories,
  };
}

export function buildDriftReport(
  refHeader: string[],
  refColumns: Cell[][],
  newHeader: string[],
  newColumns: Cell[][],
): DriftReport {
  const refIndex = new Map(refHeader.map((name, i) => [name, i]));
  const newIndex = new Map(newHeader.map((name, i) => [name, i]));

  const added = newHeader.filter((name) => !refIndex.has(name));
  const removed = refHeader.filter((name) => !newIndex.has(name));
  const typeChanged: DriftReport['schema']['typeChanged'] = [];
  const columns: ColumnDrift[] = [];

  const comparable = (type: ColumnType) =>
    type === 'numeric' || type === 'categorical' || type === 'boolean';

  for (const name of refHeader) {
    const newAt = newIndex.get(name);
    if (newAt === undefined) continue;
    const ref = refColumns[refIndex.get(name)!];
    const next = newColumns[newAt];
    const refType = inferColumnType(name, ref);
    const newType = inferColumnType(name, next);
    if (refType !== newType) typeChanged.push({ column: name, from: refType, to: newType });

    // PSI only makes sense when BOTH sides live in the same space: an id, date
    // or text column carries no useful PSI (a fresh batch's ids always "drift"),
    // and a numeric↔categorical retype is apples to oranges — the schema diff
    // above already flags those.
    if (!comparable(refType) || !comparable(newType)) continue;
    if (refType === 'numeric' && newType === 'numeric') {
      columns.push(numericDrift(name, ref, next));
    } else if (refType !== 'numeric' && newType !== 'numeric') {
      columns.push(categoricalDrift(name, ref, next));
    }
  }

  columns.sort((a, b) => b.psi - a.psi || a.column.localeCompare(b.column));
  const driftedColumns = columns.filter((c) => c.severity !== 'stable').length;
  const worst = columns.reduce<DriftSeverity>((acc, c) => {
    if (c.severity === 'strong' || acc === 'strong') return 'strong';
    if (c.severity === 'moderate' || acc === 'moderate') return 'moderate';
    return acc;
  }, 'stable');
  const schemaSeverity: DriftSeverity =
    added.length + removed.length + typeChanged.length > 0 ? 'moderate' : 'stable';

  return {
    refRows: refColumns[0]?.length ?? 0,
    newRows: newColumns[0]?.length ?? 0,
    schema: { added, removed, typeChanged },
    columns,
    driftedColumns,
    severity: worst === 'stable' ? schemaSeverity : worst,
  };
}

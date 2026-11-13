/**
 * Data drift between a REFERENCE dataset and a NEW one — the MLOps gesture of
 * checking that a fresh batch still looks like what a model was trained on.
 * Schema diff, Population Stability Index per shared column (bins built from
 * the reference), new/vanished categories, missing-rate shifts. Pure and
 * deterministic.
 *
 * V62: the conventional PSI thresholds 0.1 / 0.25 still grade severity, but
 * only for a PSI that is above its noise ceiling (see `noise.ts`). Before,
 * two halves of one small file were reported as drifted: the thresholds read
 * the sample size, not the data.
 */
import { inferColumnType, isMissing } from '@/features/ml/data/infer';
import { quantileSorted } from '@/features/data/quality/checks';
import { missingRatio, numbersOf, sharesOverEdges } from '@/features/data/quality/distribution';
import { noiseCeiling, pooledShares, psi } from '@/features/data/quality/noise';
import type { Cell, ColumnType } from '@/features/ml/data/types';

export { psi };

const NUMERIC_BINS = 10;
const TOP_CATEGORIES = 10;
const MODERATE_PSI = 0.1;
const STRONG_PSI = 0.25;

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
  /**
   * V62: what this PSI stays under when nothing moved, at these two sizes.
   * Computed only from a PSI of 0.1: under it the column is stable either way.
   */
  ceiling?: number;
  /** V62: a PSI of 0.1 or more that its ceiling explains. Stable, and said so. */
  noise?: true;
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

/** The conventional reading of a raw PSI, with no regard for sample size. */
export function severityOf(psi: number): DriftSeverity {
  if (psi < MODERATE_PSI) return 'stable';
  if (psi < STRONG_PSI) return 'moderate';
  return 'strong';
}

/** V62: the conventional reading, for a PSI that its noise ceiling does not explain. */
export function gradeDrift(value: number, ceiling: number): DriftSeverity {
  return value <= ceiling ? 'stable' : severityOf(value);
}

/** Chance, when nothing moved at all, that one report flags at least one column. */
export const DRIFT_FALSE_ALERT_RATE = 0.05;

/** A column's drift before its noise is known, with what the ceiling needs. */
export interface MeasuredDrift {
  drift: ColumnDrift;
  /** Reference shares over the bins the PSI was computed on. */
  shares: number[];
  /** The new file's shares over the same bins. */
  newShares: number[];
  /** Non-missing values on each side. */
  refCount: number;
  newCount: number;
}

/**
 * V62: grades every column of one report against its own noise ceiling. The
 * level is shared between the columns (Bonferroni): one false alert in twenty
 * per REPORT, however wide the file. The ceiling is simulated only where it
 * can change the answer, from a PSI of 0.1.
 */
export function gradeAgainstNoise(measured: readonly MeasuredDrift[]): ColumnDrift[] {
  const level = 1 - DRIFT_FALSE_ALERT_RATE / Math.max(1, measured.length);
  return measured.map(({ drift, shares, newShares, refCount, newCount }) => {
    if (drift.psi < MODERATE_PSI) return { ...drift, severity: 'stable' as const };
    const ceiling = noiseCeiling(
      pooledShares(shares, refCount, newShares, newCount),
      refCount,
      newCount,
      level,
    );
    const severity = gradeDrift(drift.psi, ceiling);
    return {
      ...drift,
      severity,
      ceiling,
      ...(severity === 'stable' && { noise: true as const }),
    };
  });
}

function numericDrift(column: string, ref: Cell[], next: Cell[]): MeasuredDrift {
  const refNumbers = numbersOf(ref).sort((a, b) => a - b);
  const newNumbers = numbersOf(next);
  const edges: number[] = [];
  for (let b = 1; b < NUMERIC_BINS; b++) {
    const edge = quantileSorted(refNumbers, b / NUMERIC_BINS);
    if (edges.length === 0 || edge > edges[edges.length - 1]) edges.push(edge);
  }
  const refShares = sharesOverEdges(edges, refNumbers);
  const newShares = sharesOverEdges(edges, newNumbers);
  const value = refNumbers.length === 0 || newNumbers.length === 0 ? 0 : psi(refShares, newShares);
  const mean = (numbers: number[]) =>
    numbers.length > 0 ? numbers.reduce((a, v) => a + v, 0) / numbers.length : 0;
  return {
    drift: {
      column,
      kind: 'numeric',
      psi: value,
      severity: severityOf(value),
      refMissingRatio: missingRatio(ref),
      newMissingRatio: missingRatio(next),
      refMean: mean(refNumbers),
      newMean: mean(newNumbers),
    },
    shares: refShares,
    newShares,
    refCount: refNumbers.length,
    newCount: newNumbers.length,
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

function categoricalDrift(column: string, ref: Cell[], next: Cell[]): MeasuredDrift {
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
  const refShares = share(refCounts);
  const newShares = share(newCounts);
  const value = refCounts.total === 0 || newCounts.total === 0 ? 0 : psi(refShares, newShares);

  const newCategories = [...newCounts.counts.keys()]
    .filter((category) => !refCounts.counts.has(category))
    .sort()
    .slice(0, 6);
  const goneCategories = [...refCounts.counts.keys()]
    .filter((category) => !newCounts.counts.has(category))
    .sort()
    .slice(0, 6);

  return {
    drift: {
      column,
      kind: 'categorical',
      psi: value,
      severity: severityOf(value),
      refMissingRatio: missingRatio(ref),
      newMissingRatio: missingRatio(next),
      newCategories,
      goneCategories,
    },
    shares: refShares,
    newShares,
    refCount: refCounts.total,
    newCount: newCounts.total,
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
  const measured: MeasuredDrift[] = [];

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
      measured.push(numericDrift(name, ref, next));
    } else if (refType !== 'numeric' && newType !== 'numeric') {
      measured.push(categoricalDrift(name, ref, next));
    }
  }

  const columns = gradeAgainstNoise(measured);
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

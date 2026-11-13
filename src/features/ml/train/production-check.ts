/**
 * V61: the production check.
 *
 * A model in production ages without notice: the data moves, the model does
 * not. Three questions, from the cheapest to the most reliable. Do the
 * columns still look like the ones it was trained on? Does it still answer
 * the way it did? And, when the true answers are known, is it wrong more
 * often? The first two are warnings; only the third is a measured loss.
 *
 * Two rules shape the verdict.
 *
 * 1. A drift is a reason to look, a measured drop is a reason to retrain.
 *    Without labels the verdict stops at « watch ».
 *
 * 2. A drift counts only when it can be told from the draw. Measured before
 *    building, on batches drawn from the SAME file as the reference, so that
 *    every alert is a false one. With the usual PSI thresholds (0.1 moderate,
 *    0.25 strong), the share of such batches raising a « strong » alert:
 *
 *      batch rows   titanic   fraud   mpg
 *          30        100 %     97 %   100 %
 *          50         97 %     75 %    96 %
 *         100         78 %      8 %    24 %
 *         150         48 %      2 %     3 %
 *
 *    The cause is arithmetic: over B bins the PSI of two samples of the same
 *    population averages about (B − 1) × (1/n + 1/n_ref), 0.09 for 10 bins
 *    and 100 rows before the reference adds its own share, and titanic has
 *    thirteen columns to trip on. A fixed threshold reads sample size as
 *    drift.
 *
 *    So each PSI is compared to its own noise ceiling: the value it stays
 *    under, 95 checks in 100 across all the signals of one check, when the
 *    batch and the reference are two draws of the same shares at their real
 *    sizes. The ceiling is simulated (seeded), not approximated: the PSI's
 *    smoothing of empty bins makes it far heavier-tailed than a chi-square on
 *    small batches. On the same batches the rule raised a false drift on
 *    1.5 to 6.5 % of checks, at every size from 30 to 150 rows (1.5 to 6 %
 *    since V62, which draws both sides from the two samples put together).
 *
 *    And it still sees a real move. On held-out rows filtered to one group
 *    (titanic third class, fraud at night, mpg from 1979 on) every check
 *    named the columns of the filter; the performance held inside its noise
 *    on all but one, mpg from 1979 on, where the RMSE went from 2.61 to 3.46
 *    with an interval that excludes zero: the one « retrain ». On mpg's eight
 *    cylinders the columns moved furthest of all and the error went DOWN,
 *    which is rule 1 in one line.
 *
 * The reference travels inside the model export: bin edges and shares, counts
 * and two moments of the test errors. Never a row.
 *
 * Pure and deterministic.
 */
import { psi } from '@/features/data/quality/drift';
import { noiseCeiling, pooledShares } from '@/features/data/quality/noise';
import { sharesOverEdges } from '@/features/data/quality/distribution';
import {
  buildProfile,
  compareToProfile,
  type ColumnProfileEntry,
  type DataProfile,
} from '@/features/data/quality/reference';
import { wilsonInterval } from '@/features/ml/train/conformal';
import type { Cell } from '@/features/ml/data/types';

export { noiseCeiling };

export const REFERENCE_VERSION = 1;

/** Chance, under no drift at all, that one check raises at least one drift. */
export const FALSE_ALERT_RATE = 0.05;

/** Bins of the predicted value, in regression. */
const PREDICTION_BINS = 10;

/** Under this many labelled rows a mean squared error has no usable interval. */
export const MIN_LABELLED_ROWS = 30;

const Z95 = 1.959963984540054;

export type PredictionReference =
  | { kind: 'classes'; rows: number; shares: number[] }
  | { kind: 'values'; rows: number; edges: number[]; shares: number[] };

export interface PerformanceReference {
  rows: number;
  /** Classification: share of correct answers on the test split. */
  accuracy?: number;
  /** Regression: mean squared error on the test split, and the spread of the squared errors. */
  mse?: number;
  squaredErrorSd?: number;
}

/** What a model export carries so a later batch can be read against it. */
export interface ProductionReference {
  v: typeof REFERENCE_VERSION;
  /** Training rows the columns were profiled on. */
  rows: number;
  columns: ColumnProfileEntry[];
  predictions: PredictionReference;
  performance: PerformanceReference;
}

export interface ReferenceInput {
  /** Source columns the model uses, with their cells on the TRAINING rows. */
  header: readonly string[];
  trainColumns: Cell[][];
  isClassification: boolean;
  classCount: number;
  /** Predictions on rows the model was not fitted on (validation and test). */
  heldOutPredictions: readonly number[];
  /** Test split: predictions and truth, for the performance reference. */
  testPredictions: readonly number[];
  testTruth: readonly number[];
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return low === high ? sorted[low] : sorted[low] + (position - low) * (sorted[high] - sorted[low]);
}

const mean = (values: readonly number[]) =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

function classShares(predictions: readonly number[], classCount: number): number[] {
  const counts = new Array<number>(classCount).fill(0);
  for (const value of predictions) if (value >= 0 && value < classCount) counts[value] += 1;
  return counts.map((count) => (predictions.length > 0 ? count / predictions.length : 0));
}

export function buildReference(input: ReferenceInput): ProductionReference {
  const profile = buildProfile(input.header, input.trainColumns, '');
  let predictions: PredictionReference;
  if (input.isClassification) {
    predictions = {
      kind: 'classes',
      rows: input.heldOutPredictions.length,
      shares: classShares(input.heldOutPredictions, input.classCount),
    };
  } else {
    const sorted = [...input.heldOutPredictions].sort((a, b) => a - b);
    const edges: number[] = [];
    for (let b = 1; b < PREDICTION_BINS; b++) {
      const edge = quantile(sorted, b / PREDICTION_BINS);
      if (edges.length === 0 || edge > edges[edges.length - 1]) edges.push(edge);
    }
    predictions = {
      kind: 'values',
      rows: sorted.length,
      edges,
      shares: sharesOverEdges(edges, sorted),
    };
  }

  const rows = input.testTruth.length;
  let performance: PerformanceReference;
  if (input.isClassification) {
    let hits = 0;
    for (let i = 0; i < rows; i++) if (input.testPredictions[i] === input.testTruth[i]) hits += 1;
    performance = { rows, accuracy: rows > 0 ? hits / rows : 0 };
  } else {
    const squared = input.testTruth.map((truth, i) => (input.testPredictions[i] - truth) ** 2);
    const mse = mean(squared);
    const variance = mean(squared.map((value) => (value - mse) ** 2));
    performance = { rows, mse, squaredErrorSd: Math.sqrt(variance) };
  }

  return {
    v: REFERENCE_VERSION,
    rows: profile.rowCount,
    columns: profile.columns,
    predictions,
    performance,
  };
}

const isShare = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1;
const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function parseColumn(raw: unknown): ColumnProfileEntry | null {
  if (!isObject(raw) || typeof raw.column !== 'string' || !isShare(raw.missingRatio)) return null;
  if (raw.kind === 'numeric') {
    if (!Array.isArray(raw.edges) || !Array.isArray(raw.shares) || !isNumber(raw.mean)) return null;
    if (!raw.edges.every(isNumber) || !raw.shares.every(isShare)) return null;
    if (raw.shares.length !== raw.edges.length + 1) return null;
    return {
      kind: 'numeric',
      column: raw.column,
      missingRatio: raw.missingRatio,
      mean: raw.mean,
      edges: raw.edges,
      shares: raw.shares,
    };
  }
  if (raw.kind === 'categorical' && isObject(raw.shares)) {
    const shares: Record<string, number> = {};
    for (const [name, share] of Object.entries(raw.shares)) {
      if (!isShare(share)) return null;
      shares[name] = share;
    }
    if (Object.keys(shares).length === 0) return null;
    return { kind: 'categorical', column: raw.column, missingRatio: raw.missingRatio, shares };
  }
  return null;
}

/**
 * Reads the reference of an export. Null for anything that is not a complete
 * reference: a model whose reference cannot be trusted is still a model, and
 * is checked on its labels alone.
 */
export function parseReference(raw: unknown): ProductionReference | null {
  if (!isObject(raw) || raw.v !== REFERENCE_VERSION || !isCount(raw.rows)) return null;
  if (!Array.isArray(raw.columns)) return null;
  const columns: ColumnProfileEntry[] = [];
  for (const entry of raw.columns) {
    const column = parseColumn(entry);
    if (!column) return null;
    columns.push(column);
  }

  const p = raw.predictions;
  if (!isObject(p) || !isCount(p.rows) || !Array.isArray(p.shares) || !p.shares.every(isShare)) {
    return null;
  }
  let predictions: PredictionReference;
  if (p.kind === 'classes') {
    predictions = { kind: 'classes', rows: p.rows, shares: p.shares };
  } else if (p.kind === 'values' && Array.isArray(p.edges) && p.edges.every(isNumber)) {
    if (p.shares.length !== p.edges.length + 1) return null;
    predictions = { kind: 'values', rows: p.rows, edges: p.edges, shares: p.shares };
  } else {
    return null;
  }

  const f = raw.performance;
  if (!isObject(f) || !isCount(f.rows)) return null;
  const performance: PerformanceReference = { rows: f.rows };
  if (isShare(f.accuracy)) performance.accuracy = f.accuracy;
  if (isNumber(f.mse) && f.mse >= 0 && isNumber(f.squaredErrorSd) && f.squaredErrorSd >= 0) {
    performance.mse = f.mse;
    performance.squaredErrorSd = f.squaredErrorSd;
  }
  if (performance.accuracy === undefined && performance.mse === undefined) return null;

  return { v: REFERENCE_VERSION, rows: raw.rows, columns, predictions, performance };
}

export interface DriftSignal {
  /** Column name; absent for the predictions. */
  column?: string;
  psi: number;
  /** What this PSI stays under when nothing moved, at these sizes. */
  ceiling: number;
  /** True when the PSI is above its ceiling: the move can be told from the draw. */
  drifted: boolean;
  rows: number;
  refMean?: number;
  newMean?: number;
}

export type PerformanceSignal =
  | { status: 'no-labels' }
  | { status: 'too-few'; rows: number; min: number }
  | { status: 'no-spread'; rows: number }
  | {
      status: 'measured';
      metric: 'accuracy' | 'rmse';
      rows: number;
      reference: number;
      batch: number;
      /** Batch minus reference, in the metric's unit (accuracy share, squared error). */
      delta: number;
      lo: number;
      hi: number;
      /** 'drop' and 'gain' only when the interval excludes zero. */
      reading: 'drop' | 'gain' | 'noise';
    };

export type Verdict = 'stable' | 'watch' | 'retrain';

export interface ProductionCheck {
  verdict: Verdict;
  rows: number;
  /** False when the export predates V61 and carries no reference. */
  hasReference: boolean;
  /** Columns of the model, most drifted first; empty without a reference. */
  columns: DriftSignal[];
  /** Columns of the reference the batch does not have (never happens when scoring succeeds). */
  driftedColumns: number;
  predictions: DriftSignal | null;
  performance: PerformanceSignal;
}

export interface BatchInput {
  header: readonly string[];
  columns: Cell[][];
  /** Class index or predicted value, one per row. */
  predictions: readonly number[];
  /** Labelled rows only: what the model said and what was true. */
  labelled?: { predictions: readonly number[]; truth: readonly number[] };
  isClassification: boolean;
  /** Reference of an export that carries none: the manifest's own test figures. */
  fallback?: { rows: number | null; accuracy?: number };
}

function performanceSignal(
  batch: BatchInput,
  reference: PerformanceReference | undefined,
): PerformanceSignal {
  const labelled = batch.labelled;
  if (!labelled || labelled.truth.length === 0) return { status: 'no-labels' };
  const rows = labelled.truth.length;

  if (batch.isClassification) {
    const refRows = reference?.rows ?? batch.fallback?.rows ?? null;
    const refAccuracy = reference?.accuracy ?? batch.fallback?.accuracy;
    if (refRows === null || refRows < 1 || refAccuracy === undefined) {
      return { status: 'no-spread', rows };
    }
    let hits = 0;
    for (let i = 0; i < rows; i++) if (labelled.predictions[i] === labelled.truth[i]) hits += 1;
    const accuracy = hits / rows;
    // Newcombe's interval for the difference of two independent shares.
    const b = wilsonInterval(accuracy, rows);
    const r = wilsonInterval(refAccuracy, refRows);
    const delta = accuracy - refAccuracy;
    const lo = delta - Math.hypot(accuracy - b.lo, r.hi - refAccuracy);
    const hi = delta + Math.hypot(b.hi - accuracy, refAccuracy - r.lo);
    return {
      status: 'measured',
      metric: 'accuracy',
      rows,
      reference: refAccuracy,
      batch: accuracy,
      delta,
      lo,
      hi,
      reading: hi < 0 ? 'drop' : lo > 0 ? 'gain' : 'noise',
    };
  }

  if (rows < MIN_LABELLED_ROWS) return { status: 'too-few', rows, min: MIN_LABELLED_ROWS };
  if (reference?.mse === undefined || reference.squaredErrorSd === undefined) {
    return { status: 'no-spread', rows };
  }
  const squared = labelled.truth.map((truth, i) => (labelled.predictions[i] - truth) ** 2);
  const mse = mean(squared);
  const variance = mean(squared.map((value) => (value - mse) ** 2));
  // Two independent means of squared errors: the central limit theorem gives
  // the interval of their difference. An error that grew has a positive delta.
  const se = Math.sqrt(variance / rows + reference.squaredErrorSd ** 2 / reference.rows);
  const delta = mse - reference.mse;
  const lo = delta - Z95 * se;
  const hi = delta + Z95 * se;
  return {
    status: 'measured',
    metric: 'rmse',
    rows,
    reference: Math.sqrt(reference.mse),
    batch: Math.sqrt(mse),
    delta,
    lo,
    hi,
    reading: lo > 0 ? 'drop' : hi < 0 ? 'gain' : 'noise',
  };
}

/**
 * Reads one batch against the reference its model was exported with: the
 * three signals, and one verdict with nothing hidden behind it.
 */
export function checkProduction(
  reference: ProductionReference | null | undefined,
  batch: BatchInput,
): ProductionCheck {
  const rows = batch.predictions.length;
  const performance = performanceSignal(batch, reference?.performance);
  const columns: DriftSignal[] = [];
  let predictions: DriftSignal | null = null;

  if (reference) {
    const profile: DataProfile = {
      format: 'labml-data-profile/1',
      source: '',
      createdAt: '',
      rowCount: reference.rows,
      columns: reference.columns,
    };
    const comparison = compareToProfile(profile, batch.header, batch.columns, { grade: 'raw' });
    // One false alert in twenty per CHECK, not per column: the level is
    // shared between every signal read (Bonferroni).
    const signals = comparison.columns.length + 1;
    const level = 1 - FALSE_ALERT_RATE / signals;
    for (const { drift, shares, newShares, refCount, newCount } of comparison.measured) {
      const present = newCount;
      // Both sides are drawn from the two samples put together: what « nothing
      // moved » means (V62).
      const ceiling = noiseCeiling(
        pooledShares(shares, refCount, newShares, newCount),
        refCount,
        newCount,
        level,
      );
      columns.push({
        column: drift.column,
        psi: drift.psi,
        ceiling,
        drifted: drift.psi > ceiling,
        rows: present,
        ...(drift.refMean !== undefined && { refMean: drift.refMean }),
        ...(drift.newMean !== undefined && { newMean: drift.newMean }),
      });
    }
    // Furthest above its own ceiling first: that is what « most drifted » means here.
    columns.sort(
      (a, b) =>
        Number(b.drifted) - Number(a.drifted) ||
        b.psi - b.ceiling - (a.psi - a.ceiling) ||
        (a.column ?? '').localeCompare(b.column ?? ''),
    );

    const ref = reference.predictions;
    const now =
      ref.kind === 'classes'
        ? classShares(batch.predictions, ref.shares.length)
        : sharesOverEdges(ref.edges, [...batch.predictions]);
    const value = rows > 0 ? psi(ref.shares, now) : 0;
    const ceiling = noiseCeiling(
      pooledShares(ref.shares, ref.rows, now, rows),
      ref.rows,
      rows,
      level,
    );
    predictions = { psi: value, ceiling, drifted: value > ceiling, rows };
  }

  const driftedColumns = columns.filter((column) => column.drifted).length;
  const drift = driftedColumns > 0 || predictions?.drifted === true;
  const dropped = performance.status === 'measured' && performance.reading === 'drop';
  const verdict: Verdict = dropped ? 'retrain' : drift ? 'watch' : 'stable';

  return {
    verdict,
    rows,
    hasReference: Boolean(reference),
    columns,
    driftedColumns,
    predictions,
    performance,
  };
}

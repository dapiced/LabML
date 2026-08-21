/**
 * Per-segment analysis — "where does my model fail?". The held-out test set
 * is sliced by every categorical column of the dataset (the target excluded,
 * columns OUTSIDE the feature set included: proxy effects show up there), and
 * the inspected model's primary metric is recomputed on each slice. Gaps
 * against the overall metric are findings to investigate, not verdicts —
 * and slices too small to mean anything are excluded, and said so.
 */
import { inferColumnType, isMissing } from '@/features/ml/data/infer';
import type { Cell } from '@/features/ml/data/types';
import type { ModelKey } from '@/features/ml/train/types';

/** Below this many test rows, a slice metric is noise — excluded, counted. */
export const MIN_SEGMENT_ROWS = 8;
const MAX_COLUMNS = 6;
const MAX_SEGMENTS = 8;

export interface SegmentRow {
  value: string;
  rows: number;
  /** Primary metric on the slice: accuracy (classification) or RMSE. */
  metric: number;
  /** metric − overall; the harmful direction depends on the metric. */
  delta: number;
}

export interface SegmentColumn {
  column: string;
  /** Whether the column was part of the model's feature set. */
  inFeatures: boolean;
  /** Worst slice first (lowest accuracy / highest RMSE). */
  segments: SegmentRow[];
  /** Largest |delta| across kept slices — ranks the columns. */
  spread: number;
  /** Slices excluded for having fewer than MIN_SEGMENT_ROWS test rows. */
  smallSegments: number;
}

export interface SegmentAnalysis {
  model: ModelKey;
  isClassification: boolean;
  metricLabel: 'accuracy' | 'rmse';
  overall: number;
  testRows: number;
  minRows: number;
  /** Ranked by spread, widest gaps first, capped. */
  columns: SegmentColumn[];
}

function sliceMetric(indices: number[], y: number[], yhat: number[], classification: boolean) {
  if (classification) {
    let correct = 0;
    for (const i of indices) if (y[i] === yhat[i]) correct += 1;
    return correct / indices.length;
  }
  let sum = 0;
  for (const i of indices) sum += (y[i] - yhat[i]) ** 2;
  return Math.sqrt(sum / indices.length);
}

/**
 * `testIndices[i]` is the ORIGINAL row of test position `i`; `testY` and
 * `predictions` are aligned with test positions. Returns null when nothing
 * can be sliced (no categorical column, or a tiny test set).
 */
export function analyzeSegments(
  header: string[],
  columns: Cell[][],
  testIndices: number[],
  testY: number[],
  predictions: number[],
  isClassification: boolean,
  target: string,
  featureColumns: string[],
  model: ModelKey,
): SegmentAnalysis | null {
  if (testIndices.length < MIN_SEGMENT_ROWS * 2) return null;
  const overall = sliceMetric(
    testIndices.map((_, position) => position),
    testY,
    predictions,
    isClassification,
  );

  const out: SegmentColumn[] = [];
  for (let c = 0; c < header.length; c++) {
    if (header[c] === target) continue;
    const type = inferColumnType(header[c], columns[c]);
    if (type !== 'categorical' && type !== 'boolean') continue;

    // Test positions grouped by the row's raw (trimmed) category value.
    const groups = new Map<string, number[]>();
    for (let position = 0; position < testIndices.length; position++) {
      const raw = columns[c][testIndices[position]];
      if (isMissing(raw)) continue;
      const value = (raw as string).trim();
      const bucket = groups.get(value);
      if (bucket) bucket.push(position);
      else groups.set(value, [position]);
    }

    let smallSegments = 0;
    const segments: SegmentRow[] = [];
    for (const [value, positions] of groups) {
      if (positions.length < MIN_SEGMENT_ROWS) {
        smallSegments += 1;
        continue;
      }
      const metric = sliceMetric(positions, testY, predictions, isClassification);
      segments.push({ value, rows: positions.length, metric, delta: metric - overall });
    }
    if (segments.length < 2) continue;

    // Worst first: low accuracy, or high RMSE; deterministic tiebreak.
    segments.sort((a, b) => {
      const primary = isClassification ? a.metric - b.metric : b.metric - a.metric;
      return primary !== 0 ? primary : a.value.localeCompare(b.value);
    });
    out.push({
      column: header[c],
      inFeatures: featureColumns.includes(header[c]),
      segments: segments.slice(0, MAX_SEGMENTS),
      spread: Math.max(...segments.map((s) => Math.abs(s.delta))),
      smallSegments,
    });
  }
  if (out.length === 0) return null;

  out.sort((a, b) => b.spread - a.spread || a.column.localeCompare(b.column));
  return {
    model,
    isClassification,
    metricLabel: isClassification ? 'accuracy' : 'rmse',
    overall,
    testRows: testIndices.length,
    minRows: MIN_SEGMENT_ROWS,
    columns: out.slice(0, MAX_COLUMNS),
  };
}

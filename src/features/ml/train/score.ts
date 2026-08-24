/**
 * Batch scoring — the production gesture: after a run, a NEW file is scored by
 * a trained model, entirely in the browser. Predictions for every row, and
 * when the file carries the target column, an honest metrics comparison
 * against the held-out test set. Rows whose label was never seen in training
 * are predicted but excluded from the metrics (and counted).
 */
import { isMissing, parseNumber } from '@/features/ml/data/infer';
import { scoreModel, type TrainArtifacts } from '@/features/ml/train/trainer';
import type { TrainedModel } from '@/features/ml/train/models';
import type { FittedPipeline } from '@/features/ml/train/pipeline';
import type { Cell } from '@/features/ml/data/types';
import type { MetricMap, ModelKey } from '@/features/ml/train/types';
import { csvCell } from '@/lib/csv';

const PREVIEW_ROWS = 8;

export interface BatchScore {
  fileName: string;
  model: ModelKey;
  rowCount: number;
  hasTarget: boolean;
  /** Labeled rows actually used for the metrics (target present only). */
  labeledRows: number;
  /** Rows whose target label was never seen in training (classification). */
  unknownLabels: number;
  /** Metrics on the new batch's labeled rows (target present only). */
  metrics?: MetricMap;
  /** The same model's held-out test metrics, recomputed for the comparison. */
  testMetrics: MetricMap;
  preview: { predicted: string; actual?: string; proba?: number }[];
  /** Full predictions: every original column + predicted (+ probabilities). */
  csv: string;
}

/**
 * Everything needed to score raw rows — built from a live run's artifacts,
 * or rebuilt from an imported export (v22). Same code path either way.
 */
export interface RowScorer {
  model: TrainedModel;
  specs: FittedPipeline['specs'];
  transformRow(record: Record<string, Cell>): number[];
  classes: string[];
  isClassification: boolean;
}

/** Source columns the fitted pipeline needs, in fitting order. */
export function requiredColumnsOf(specs: FittedPipeline['specs']): string[] {
  return [...new Set(specs.map((spec) => spec.name))];
}

export function requiredColumns(artifacts: TrainArtifacts): string[] {
  return requiredColumnsOf(artifacts.pipeline.specs);
}

export function scoreBatch(
  artifacts: TrainArtifacts,
  modelKey: ModelKey,
  target: string,
  fileName: string,
  header: string[],
  columns: Cell[][],
): BatchScore {
  const model = artifacts.models.get(modelKey);
  if (!model) throw new Error('model-not-found');
  const referenceMetrics = scoreModel(
    model,
    artifacts.testX,
    artifacts.testY,
    artifacts.isClassification,
    artifacts.classes.length,
  ).metrics;
  return scoreRows(
    {
      model,
      specs: artifacts.pipeline.specs,
      transformRow: artifacts.pipeline.transformRow,
      classes: artifacts.classes,
      isClassification: artifacts.isClassification,
    },
    modelKey,
    referenceMetrics,
    target,
    fileName,
    header,
    columns,
  );
}

/** Scores a parsed file with any RowScorer; `referenceMetrics` fills the
 * honest comparison column (held-out test of the live or exporting run). */
export function scoreRows(
  scorer: RowScorer,
  modelKey: ModelKey,
  referenceMetrics: MetricMap,
  target: string,
  fileName: string,
  header: string[],
  columns: Cell[][],
): BatchScore {
  const { model, classes, isClassification } = scorer;

  const index = new Map(header.map((name, i) => [name, i]));
  const missing = requiredColumnsOf(scorer.specs).filter((name) => !index.has(name));
  if (missing.length > 0) throw new Error(`missing-columns:${missing.join(', ')}`);

  const rowCount = columns[0]?.length ?? 0;
  if (rowCount === 0) throw new Error('empty');

  const required = requiredColumnsOf(scorer.specs);
  const X: number[][] = [];
  for (let r = 0; r < rowCount; r++) {
    const record: Record<string, Cell> = {};
    for (const name of required) {
      record[name] = columns[index.get(name)!][r];
    }
    X.push(scorer.transformRow(record));
  }

  // V37: one pass where the family offers one (k-NN) — same numbers, half the
  // neighbour searches. See `predictWithProba` on TrainedModel.
  const both = model.predictWithProba?.(X) ?? null;
  const predictions = both?.labels ?? model.predict(X);
  const probabilities =
    isClassification && model.predictProba ? (both?.proba ?? model.predictProba(X)) : null;
  const label = (value: number): string =>
    isClassification ? (classes[value] ?? String(value)) : String(value);

  // Metrics on the labeled subset, when the file carries the target column.
  const targetAt = index.get(target);
  const hasTarget = targetAt !== undefined;
  let labeledRows = 0;
  let unknownLabels = 0;
  let metrics: MetricMap | undefined;
  const actuals: (string | null)[] = [];
  if (hasTarget) {
    const classIndex = new Map(classes.map((name, i) => [name, i]));
    const subX: number[][] = [];
    const subY: number[] = [];
    for (let r = 0; r < rowCount; r++) {
      const raw = columns[targetAt!][r];
      actuals.push(isMissing(raw) ? null : (raw as string).trim());
      if (isMissing(raw)) continue;
      const value = (raw as string).trim();
      if (isClassification) {
        const encoded = classIndex.get(value);
        if (encoded === undefined) {
          unknownLabels += 1;
          continue;
        }
        subX.push(X[r]);
        subY.push(encoded);
      } else {
        const parsed = parseNumber(value);
        if (parsed === null) continue;
        subX.push(X[r]);
        subY.push(parsed);
      }
    }
    labeledRows = subY.length;
    if (labeledRows > 0) {
      metrics = scoreModel(model, subX, subY, isClassification, classes.length).metrics;
    }
  }

  const testMetrics = referenceMetrics;

  const preview = predictions.slice(0, PREVIEW_ROWS).map((value, r) => ({
    predicted: label(value),
    ...(hasTarget && actuals[r] !== null ? { actual: actuals[r]! } : {}),
    ...(probabilities ? { proba: probabilities[r][value] ?? 0 } : {}),
  }));

  // The exportable file keeps every original column so it re-joins cleanly.
  const csvHeader = [
    ...header,
    'predicted',
    ...(probabilities ? classes.map((name) => `p_${name}`) : []),
  ];
  const lines = [csvHeader.map(csvCell).join(',')];
  for (let r = 0; r < rowCount; r++) {
    const cells = header.map((_, c) => csvCell(columns[c][r] ?? ''));
    cells.push(csvCell(label(predictions[r])));
    if (probabilities) cells.push(...probabilities[r].map((p) => p.toFixed(4)));
    lines.push(cells.join(','));
  }

  return {
    fileName,
    model: modelKey,
    rowCount,
    hasTarget,
    labeledRows,
    unknownLabels,
    metrics,
    testMetrics,
    preview,
    csv: lines.join('\n'),
  };
}

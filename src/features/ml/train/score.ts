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
import {
  applyMulticlassPolicy,
  evaluateMulticlassPolicy,
  type MulticlassDecisionMetrics,
  type MulticlassDecisionPolicy,
} from '@/features/ml/train/multiclass-decision';

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
  /** Label-independent policy coverage over every scored row. */
  decisionSummary?: { rows: number; decided: number; abstained: number; coverage: number };
  /** Policy metrics on known labeled rows; absent when labels are unavailable. */
  decision?: MulticlassDecisionMetrics;
  preview: {
    predicted: string;
    actual?: string;
    proba?: number;
    rawPredicted?: string;
    policyPredicted?: string | null;
    decisionStatus?: 'decided' | 'abstained';
  }[];
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
  decisionPolicy?: MulticlassDecisionPolicy;
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
  decisionPolicy?: MulticlassDecisionPolicy,
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
      ...(decisionPolicy ? { decisionPolicy } : {}),
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
  const policyDecisions =
    scorer.decisionPolicy && probabilities
      ? probabilities.map((row) => applyMulticlassPolicy(row, scorer.decisionPolicy!))
      : null;
  const decisionSummary = policyDecisions
    ? {
        rows: policyDecisions.length,
        decided: policyDecisions.filter((item) => item.status === 'decided').length,
        abstained: policyDecisions.filter((item) => item.status === 'abstained').length,
        coverage:
          policyDecisions.length === 0
            ? 0
            : policyDecisions.filter((item) => item.status === 'decided').length /
              policyDecisions.length,
      }
    : undefined;
  const decision =
    scorer.decisionPolicy && probabilities && hasTarget && labeledRows > 0
      ? evaluateMulticlassPolicy(
          actuals.flatMap((actual) =>
            actual === null ? [] : [classes.indexOf(actual)].filter((value) => value >= 0),
          ),
          probabilities.filter(
            (_, row) => actuals[row] !== null && classes.includes(actuals[row]!),
          ),
          scorer.decisionPolicy,
        )
      : undefined;

  const preview = predictions.slice(0, PREVIEW_ROWS).map((value, r) => ({
    predicted: label(value),
    ...(hasTarget && actuals[r] !== null ? { actual: actuals[r]! } : {}),
    ...(probabilities ? { proba: probabilities[r][value] ?? 0 } : {}),
    ...(policyDecisions
      ? {
          rawPredicted: label(policyDecisions[r].rawClass),
          policyPredicted:
            policyDecisions[r].policyClass === null ? null : label(policyDecisions[r].policyClass),
          decisionStatus: policyDecisions[r].status,
        }
      : {}),
  }));

  // The exportable file keeps every original column so it re-joins cleanly.
  const csvHeader = [
    ...header,
    'predicted',
    ...(probabilities ? classes.map((name) => `p_${name}`) : []),
    ...(policyDecisions ? ['policy_decision', 'decision_status'] : []),
  ];
  const lines = [csvHeader.map(csvCell).join(',')];
  for (let r = 0; r < rowCount; r++) {
    const cells = header.map((_, c) => csvCell(columns[c][r] ?? ''));
    cells.push(csvCell(label(predictions[r])));
    if (probabilities) cells.push(...probabilities[r].map((p) => p.toFixed(4)));
    if (policyDecisions) {
      const policyClass = policyDecisions[r].policyClass;
      cells.push(csvCell(policyClass === null ? '' : label(policyClass)));
      cells.push(policyDecisions[r].status);
    }
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
    ...(decisionSummary ? { decisionSummary } : {}),
    ...(decision ? { decision } : {}),
    preview,
    csv: lines.join('\n'),
  };
}

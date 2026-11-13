import { specsToJson } from '@/features/ml/train/pipeline';
import { scoreModel, type TrainArtifacts } from '@/features/ml/train/trainer';
import type { ModelKey } from '@/features/ml/train/types';
import { csvCell } from '@/lib/csv';
import type { MulticlassDecisionPolicy } from '@/features/ml/train/multiclass-decision';
import { buildReference, type ProductionReference } from '@/features/ml/train/production-check';
import { requiredColumns } from '@/features/ml/train/score';
import type { Cell } from '@/features/ml/data/types';

export interface ExportMeta {
  target: string;
  datasetName: string;
  rowCount: number;
}

/**
 * Self-describing export of a trained model — reusable outside LabML AND
 * re-importable (v22): the format carries the fitted pipeline parameters,
 * the target, and the run's held-out test metrics as an honest reference.
 * v3 (v24) adds TF-IDF text specs; v2 files stay readable on import.
 * v5 (V61) adds the production reference: what the columns and the answers
 * looked like, so a later batch can be read against them. Shares and counts,
 * never a row.
 * Returns null for models without a serializable form (k-NN).
 */
export function serializeModel(
  artifacts: TrainArtifacts,
  key: ModelKey,
  meta: ExportMeta,
  decisionPolicy?: MulticlassDecisionPolicy,
  reference?: ProductionReference | null,
): string | null {
  const model = artifacts.models.get(key);
  if (!model?.toJSON) return null;
  const { metrics } = scoreModel(
    model,
    artifacts.testX,
    artifacts.testY,
    artifacts.isClassification,
    artifacts.classes.length,
  );
  return JSON.stringify(
    {
      app: 'LabML',
      formatVersion: 5,
      model: key,
      task: artifacts.isClassification ? 'classification' : 'regression',
      target: meta.target,
      seed: artifacts.seed,
      createdAt: Date.now(),
      sourceDataset: { name: meta.datasetName, rowCount: meta.rowCount },
      classes: artifacts.isClassification ? artifacts.classes : undefined,
      ...(decisionPolicy ? { decisionPolicy } : {}),
      /** Held-out test metrics of the exporting run — the honest reference. */
      testMetrics: metrics,
      testRows: artifacts.testY.length,
      ...(reference ? { reference } : {}),
      /** Fitted imputation/encoding/standardization parameters. */
      pipeline: { specs: specsToJson(artifacts.pipeline.specs) },
      /** Encoded feature order the parameters refer to (after one-hot/ordinal). */
      featureNames: artifacts.pipeline.featureNames,
      parameters: model.toJSON(),
    },
    null,
    2,
  );
}

/** Test-split predictions as CSV: actual, predicted, and per-class probabilities. */
export function buildPredictionsCsv(artifacts: TrainArtifacts, key: ModelKey): string {
  const model = artifacts.models.get(key);
  if (!model) throw new Error('model-not-found');
  const { testX, testY, classes, isClassification } = artifacts;
  const predictions = model.predict(testX);
  const probabilities = isClassification && model.predictProba ? model.predictProba(testX) : null;

  const label = (value: number) =>
    isClassification ? (classes[value] ?? String(value)) : String(value);
  const header = ['actual', 'predicted'];
  if (probabilities) header.push(...classes.map((c) => `p_${c}`));

  const lines = [header.map(csvCell).join(',')];
  for (let i = 0; i < testY.length; i++) {
    const row = [label(testY[i]), label(predictions[i])];
    if (probabilities) row.push(...probabilities[i].map((p) => p.toFixed(6)));
    lines.push(row.map(csvCell).join(','));
  }
  return lines.join('\n');
}

/**
 * V61: the production reference of one model of a live run. The columns are
 * profiled on the training rows; the answers are read on the rows the model
 * was not fitted on, validation and test together. Null when the artifacts
 * do not say which rows trained the model.
 */
export function referenceOf(
  artifacts: TrainArtifacts,
  key: ModelKey,
  columns: Map<string, Cell[]>,
): ProductionReference | null {
  const model = artifacts.models.get(key);
  const train = artifacts.trainIndices;
  if (!model || !train || train.length === 0) return null;
  const header = requiredColumns(artifacts).filter((name) => columns.has(name));
  const testPredictions = model.predict(artifacts.testX);
  const heldOut =
    artifacts.validationX.length > 0
      ? [...model.predict(artifacts.validationX), ...testPredictions]
      : testPredictions;
  return buildReference({
    header,
    trainColumns: header.map((name) => {
      const cells = columns.get(name)!;
      return train.map((row) => cells[row]);
    }),
    isClassification: artifacts.isClassification,
    classCount: artifacts.classes.length,
    heldOutPredictions: heldOut,
    testPredictions,
    testTruth: artifacts.testY,
  });
}

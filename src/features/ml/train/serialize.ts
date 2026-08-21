import { specsToJson } from '@/features/ml/train/pipeline';
import { scoreModel, type TrainArtifacts } from '@/features/ml/train/trainer';
import type { ModelKey } from '@/features/ml/train/types';

export interface ExportMeta {
  target: string;
  datasetName: string;
  rowCount: number;
}

/**
 * Self-describing export of a trained model — reusable outside LabML AND
 * re-importable (v22): format v2 carries the fitted pipeline parameters,
 * the target, and the run's held-out test metrics as an honest reference.
 * Returns null for models without a serializable form (k-NN).
 */
export function serializeModel(
  artifacts: TrainArtifacts,
  key: ModelKey,
  meta: ExportMeta,
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
      formatVersion: 2,
      model: key,
      task: artifacts.isClassification ? 'classification' : 'regression',
      target: meta.target,
      seed: artifacts.seed,
      createdAt: Date.now(),
      sourceDataset: { name: meta.datasetName, rowCount: meta.rowCount },
      classes: artifacts.isClassification ? artifacts.classes : undefined,
      /** Held-out test metrics of the exporting run — the honest reference. */
      testMetrics: metrics,
      testRows: artifacts.testY.length,
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

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
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

  const lines = [header.map(csvEscape).join(',')];
  for (let i = 0; i < testY.length; i++) {
    const row = [label(testY[i]), label(predictions[i])];
    if (probabilities) row.push(...probabilities[i].map((p) => p.toFixed(6)));
    lines.push(row.map(csvEscape).join(','));
  }
  return lines.join('\n');
}

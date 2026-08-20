import type { TrainArtifacts } from '@/features/ml/train/trainer';
import type { ModelKey } from '@/features/ml/train/types';

/**
 * Self-describing export of a trained model's parameters — reusable outside
 * LabML. Returns null for models without a serializable form (k-NN).
 */
export function serializeModel(artifacts: TrainArtifacts, key: ModelKey): string | null {
  const model = artifacts.models.get(key);
  if (!model?.toJSON) return null;
  return JSON.stringify(
    {
      app: 'LabML',
      formatVersion: 1,
      model: key,
      task: artifacts.isClassification ? 'classification' : 'regression',
      seed: artifacts.seed,
      classes: artifacts.isClassification ? artifacts.classes : undefined,
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

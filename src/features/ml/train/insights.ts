import { accuracy, rmse, rocAuc } from '@/features/ml/train/metrics';
import { mulberry32, shuffleInPlace } from '@/features/ml/train/random';
import type { Cell } from '@/features/ml/data/types';
import type { TrainedModel } from '@/features/ml/train/models';
import type { FittedPipeline } from '@/features/ml/train/pipeline';
import type { TrainArtifacts } from '@/features/ml/train/trainer';
import type { InsightsPayload, ModelKey, WhatIfResult } from '@/features/ml/train/types';

export interface RocPoint {
  fpr: number;
  tpr: number;
}

/** Confusion matrix indexed [true][predicted]. */
export function confusionMatrix(yTrue: number[], yPred: number[], classCount: number): number[][] {
  const matrix = Array.from({ length: classCount }, () => new Array<number>(classCount).fill(0));
  for (let i = 0; i < yTrue.length; i++) matrix[yTrue[i]][yPred[i]] += 1;
  return matrix;
}

/** ROC curve for binary scores, downsampled to at most `maxPoints` points. */
export function rocCurve(
  yTrue: number[],
  scores: number[],
  maxPoints = 100,
): { points: RocPoint[]; auc: number } | null {
  const auc = rocAuc(yTrue, scores);
  if (auc === null) return null;
  const order = yTrue.map((_, i) => i).sort((a, b) => scores[b] - scores[a]);
  const positives = yTrue.filter((v) => v === 1).length;
  const negatives = yTrue.length - positives;
  const points: RocPoint[] = [{ fpr: 0, tpr: 0 }];
  let tp = 0;
  let fp = 0;
  for (const i of order) {
    if (yTrue[i] === 1) tp += 1;
    else fp += 1;
    points.push({ fpr: fp / negatives, tpr: tp / positives });
  }
  const step = Math.max(1, Math.ceil(points.length / maxPoints));
  const sampled = points.filter((_, i) => i % step === 0);
  const last = points[points.length - 1];
  if (sampled[sampled.length - 1] !== last) sampled.push(last);
  return { points: sampled, auc };
}

/** Column-block boundaries in the encoded matrix, one entry per source column. */
export function encodedBlocks(
  pipeline: FittedPipeline,
): { column: string; start: number; width: number }[] {
  const blocks: { column: string; start: number; width: number }[] = [];
  let cursor = 0;
  for (const spec of pipeline.specs) {
    const width = spec.kind === 'onehot' ? spec.categories.length : 1;
    blocks.push({ column: spec.name, start: cursor, width });
    cursor += width;
  }
  return blocks;
}

/**
 * Model-agnostic permutation importance on the test split: shuffle one source
 * column's encoded block (all of its one-hot columns together), re-score, and
 * report the drop of the primary metric. Averaged over `repeats` seeded shuffles.
 * Positive = the model relies on that column.
 */
export function permutationImportance(
  model: TrainedModel,
  pipeline: FittedPipeline,
  testX: number[][],
  testY: number[],
  isClassification: boolean,
  seed: number,
  repeats = 3,
): { column: string; value: number }[] {
  const basePredictions = model.predict(testX);
  const baseScore = isClassification
    ? accuracy(testY, basePredictions)
    : rmse(testY, basePredictions);

  const results = encodedBlocks(pipeline).map(({ column, start, width }) => {
    let dropSum = 0;
    for (let repeat = 0; repeat < repeats; repeat++) {
      const rng = mulberry32(seed + repeat * 7919);
      const order = shuffleInPlace(
        testX.map((_, i) => i),
        rng,
      );
      const permuted = testX.map((row, i) => {
        const clone = [...row];
        const source = testX[order[i]];
        for (let j = 0; j < width; j++) clone[start + j] = source[start + j];
        return clone;
      });
      const predictions = model.predict(permuted);
      const score = isClassification ? accuracy(testY, predictions) : rmse(testY, predictions);
      // Accuracy drops when a useful column is destroyed; RMSE rises.
      dropSum += isClassification ? baseScore - score : score - baseScore;
    }
    return { column, value: dropSum / repeats };
  });

  return results.sort((a, b) => b.value - a.value);
}

/** Histogram of prediction residuals (actual − predicted). */
export function residualsHistogram(
  yTrue: number[],
  yPred: number[],
  bins = 12,
): { counts: number[]; min: number; max: number } {
  const residuals = yTrue.map((v, i) => v - yPred[i]);
  const min = Math.min(...residuals);
  const max = Math.max(...residuals);
  if (min === max) return { counts: [residuals.length], min, max };
  const counts = new Array<number>(bins).fill(0);
  const width = (max - min) / bins;
  for (const value of residuals) {
    counts[Math.min(Math.floor((value - min) / width), bins - 1)] += 1;
  }
  return { counts, min, max };
}

/** Full insights bundle for one trained model, computed on the test split. */
export function computeInsights(artifacts: TrainArtifacts, modelKey: ModelKey): InsightsPayload {
  const model = artifacts.models.get(modelKey);
  if (!model) throw new Error('model-not-found');
  const { pipeline, testX, testY, classes, isClassification, seed } = artifacts;
  const predictions = model.predict(testX);
  const importance = permutationImportance(
    model,
    pipeline,
    testX,
    testY,
    isClassification,
    seed,
  ).slice(0, 10);

  if (isClassification) {
    const payload: InsightsPayload = {
      model: modelKey,
      classes,
      confusion: confusionMatrix(testY, predictions, classes.length),
      importance,
    };
    if (classes.length === 2 && model.predictProba) {
      const roc = rocCurve(
        testY,
        model.predictProba(testX).map((p) => p[1]),
      );
      if (roc) payload.roc = roc;
    }
    return payload;
  }

  return {
    model: modelKey,
    scatter: scatterSample(testY, predictions, seed),
    residuals: residualsHistogram(testY, predictions),
    importance,
  };
}

/** Encodes one synthetic row with the fitted pipeline and predicts it. */
export function computeWhatIf(
  artifacts: TrainArtifacts,
  modelKey: ModelKey,
  values: Record<string, Cell>,
): WhatIfResult {
  const model = artifacts.models.get(modelKey);
  if (!model) throw new Error('model-not-found');
  const row = artifacts.pipeline.transformRow(values);
  const [prediction] = model.predict([row]);

  if (!artifacts.isClassification) {
    return { model: modelKey, prediction: String(Math.round(prediction * 1000) / 1000) };
  }
  const result: WhatIfResult = {
    model: modelKey,
    prediction: artifacts.classes[prediction] ?? String(prediction),
  };
  if (model.predictProba) {
    const [probs] = model.predictProba([row]);
    result.probabilities = artifacts.classes
      .map((label, index) => ({ label, p: probs[index] ?? 0 }))
      .sort((a, b) => b.p - a.p);
  }
  return result;
}

/** Seeded sample of (actual, predicted) pairs for the scatter plot. */
export function scatterSample(
  yTrue: number[],
  yPred: number[],
  seed: number,
  cap = 300,
): { actual: number; predicted: number }[] {
  const indices = yTrue.map((_, i) => i);
  if (indices.length > cap) {
    shuffleInPlace(indices, mulberry32(seed));
    indices.length = cap;
    indices.sort((a, b) => a - b);
  }
  return indices.map((i) => ({ actual: yTrue[i], predicted: yPred[i] }));
}

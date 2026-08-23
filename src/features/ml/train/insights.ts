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
    // A text column owns its whole TF-IDF block: counting it as one column
    // would shift every block after it and permute the wrong features.
    const width =
      spec.kind === 'onehot'
        ? spec.categories.length
        : spec.kind === 'text'
          ? spec.terms.length
          : 1;
    blocks.push({ column: spec.name, start: cursor, width });
    cursor += width;
  }
  return blocks;
}

/** Words scored per text column: enough to read, few enough to stay fast. */
const WORD_CANDIDATES = 40;
export interface WordEffectsResult {
  words: { column: string; term: string; effect: number; rows: number }[];
  /** Set when the method cannot measure anything — never silently empty. */
  refusal?: 'saturated';
}
/** A word seen in fewer test rows than this cannot be measured honestly. */
const MIN_WORD_TEST_ROWS = 3;

/**
 * Signed word effects by occlusion: for each candidate word, take the test
 * rows that actually contain it, erase THAT word from them (its TF-IDF weight
 * goes to zero, the rest of the review untouched), re-predict, and average the
 * shift. The sign is the point — "broken" pushes the prediction down, "parfait"
 * pushes it up — which permutation importance cannot tell you.
 *
 * Occlusion is used here rather than the permutation method above because a
 * review vocabulary is redundant: shuffling one word out of "arrived broken,
 * asking for a refund" changes nothing, so every word would score ~0.
 *
 * Deliberate limits: only binary classification with probabilities (shift of
 * p(positive class)) and regression (shift of the prediction) have a single
 * axis to project onto — multiclass is skipped rather than faked. Candidates
 * are the most present words in the test split, capped at WORD_CANDIDATES.
 *
 * V35 named a third limit, found when the smaller training split made it
 * bite: a model whose probabilities are SATURATED — Gaussian Naive Bayes on
 * ~150 TF-IDF features returns exactly 1 or exactly 0 — has no axis to move
 * along, so every occlusion measures exactly zero. That is not "no words
 * matter"; it is "this model cannot answer the question". It is refused by
 * name and said out loud, instead of the card vanishing without explanation.
 */
export function wordEffects(
  model: TrainedModel,
  pipeline: FittedPipeline,
  testX: number[][],
  isClassification: boolean,
  classCount: number,
  top = 12,
): WordEffectsResult {
  const canProject = isClassification
    ? classCount === 2 && typeof model.predictProba === 'function'
    : true;
  if (!canProject) return { words: [] };

  const textBlocks = encodedBlocks(pipeline).filter(
    (block) => pipeline.specs.find((spec) => spec.name === block.column)?.kind === 'text',
  );
  if (textBlocks.length === 0) return { words: [] };

  /** The model's answer on one axis: p(positive class), or the prediction. */
  const project = (rows: number[][]): number[] =>
    isClassification ? model.predictProba!(rows).map((p) => p[1] ?? 0) : model.predict(rows);

  const scored: { column: string; term: string; effect: number; rows: number }[] = [];
  for (const { column, start, width } of textBlocks) {
    const spec = pipeline.specs.find((s) => s.name === column);
    if (spec?.kind !== 'text') continue;

    const present: { offset: number; rows: number[] }[] = [];
    for (let j = 0; j < width; j++) {
      const rows: number[] = [];
      for (let r = 0; r < testX.length; r++) if (testX[r][start + j] !== 0) rows.push(r);
      if (rows.length >= MIN_WORD_TEST_ROWS) present.push({ offset: j, rows });
    }
    const candidates = present
      .sort((a, b) => b.rows.length - a.rows.length || a.offset - b.offset)
      .slice(0, WORD_CANDIDATES);

    for (const { offset, rows } of candidates) {
      const withWord = rows.map((r) => testX[r]);
      const without = withWord.map((row) => {
        const clone = [...row];
        clone[start + offset] = 0;
        return clone;
      });
      const before = project(withWord);
      const after = project(without);
      // Positive = keeping the word pushes the answer up.
      let shift = 0;
      for (let i = 0; i < before.length; i++) shift += before[i] - after[i];
      scored.push({
        column,
        term: spec.terms[offset],
        effect: shift / rows.length,
        rows: rows.length,
      });
    }
  }

  const words = scored
    .filter((entry) => entry.effect !== 0)
    .sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect) || a.term.localeCompare(b.term))
    .slice(0, top);
  // Measured, not guessed: candidates existed and not one of them moved the
  // answer at all. That is a saturated model, not a text without signal.
  if (words.length === 0 && scored.length > 0) return { words: [], refusal: 'saturated' };
  return { words };
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

const PDP_GRID = 20;
const PDP_COLUMNS = 2;

/**
 * Partial dependence on the most important numeric columns: sweep one column
 * across its observed range while every other feature keeps its real values,
 * and average the model's prediction at each step.
 */
export function partialDependence(
  model: TrainedModel,
  pipeline: FittedPipeline,
  testX: number[][],
  isClassification: boolean,
  importance: { column: string; value: number }[],
): { column: string; points: { x: number; y: number }[] }[] {
  if (isClassification && !model.predictProba) return [];
  const blocks = encodedBlocks(pipeline);
  const numericSpecs = new Map(
    pipeline.specs.filter((s) => s.kind === 'numeric').map((s) => [s.name, s]),
  );
  const chosen = importance
    .filter((entry) => entry.value > 0 && numericSpecs.has(entry.column))
    .slice(0, PDP_COLUMNS);

  return chosen.map(({ column }) => {
    const spec = numericSpecs.get(column)!;
    const { start } = blocks.find((b) => b.column === column)!;
    const observed = testX.map((row) => row[start]);
    const min = Math.min(...observed);
    const max = Math.max(...observed);
    const points: { x: number; y: number }[] = [];
    for (let step = 0; step < PDP_GRID; step++) {
      const value = min + ((max - min) * step) / (PDP_GRID - 1);
      const swept = testX.map((row) => {
        const clone = [...row];
        clone[start] = value;
        return clone;
      });
      const mean = isClassification
        ? model.predictProba!(swept).reduce((a, p) => a + (p[1] ?? 0), 0) / swept.length
        : model.predict(swept).reduce((a, v) => a + v, 0) / swept.length;
      points.push({ x: value * spec.std + spec.mean, y: mean });
    }
    return { column, points };
  });
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
  const wordOutcome = wordEffects(model, pipeline, testX, isClassification, classes.length);
  const words = wordOutcome.words;

  if (isClassification) {
    const payload: InsightsPayload = {
      model: modelKey,
      classes,
      confusion: confusionMatrix(testY, predictions, classes.length),
      importance,
      ...(words.length > 0 ? { words } : {}),
      ...(wordOutcome.refusal !== undefined ? { wordsRefused: wordOutcome.refusal } : {}),
    };
    if (classes.length === 2 && model.predictProba) {
      const roc = rocCurve(
        testY,
        model.predictProba(testX).map((p) => p[1]),
      );
      if (roc) payload.roc = roc;
      const pdp = partialDependence(model, pipeline, testX, true, importance);
      if (pdp.length > 0) payload.pdp = pdp;
    }
    return payload;
  }

  const payload: InsightsPayload = {
    model: modelKey,
    scatter: scatterSample(testY, predictions, seed),
    residuals: residualsHistogram(testY, predictions),
    importance,
    ...(words.length > 0 ? { words } : {}),
    ...(wordOutcome.refusal !== undefined ? { wordsRefused: wordOutcome.refusal } : {}),
  };
  const pdp = partialDependence(model, pipeline, testX, false, importance);
  if (pdp.length > 0) payload.pdp = pdp;
  return payload;
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

/**
 * Local explanations: interventional Shapley values estimated by permutation
 * sampling (Štrumbelj & Kononenko). One-hot blocks move together so each
 * contribution belongs to a SOURCE column. Along one permutation the marginal
 * gains telescope, so the estimator satisfies the efficiency property exactly:
 * the contributions sum to prediction − baseline.
 */
import { encodedBlocks } from '@/features/ml/train/insights';
import { mulberry32, shuffleInPlace } from '@/features/ml/train/random';
import type { Cell } from '@/features/ml/data/types';
import type { TrainArtifacts } from '@/features/ml/train/trainer';
import type { ModelKey } from '@/features/ml/train/types';

export const SHAPLEY_PERMUTATIONS = 8;
export const SHAPLEY_REFERENCES = 24;

export interface ShapleyExplanation {
  model: ModelKey;
  /** Class whose probability is explained — absent for regression. */
  targetClass?: string;
  /** True when the model exposes probabilities; false = 0/1 indicator of the class. */
  usedProba: boolean;
  /** Mean model output over the reference rows. */
  baseline: number;
  /** Model output on the explained row. */
  prediction: number;
  /** Per source column, sorted by |value|; sums to prediction − baseline. */
  contributions: { column: string; value: number }[];
  permutations: number;
  references: number;
}

export function explainPrediction(
  artifacts: TrainArtifacts,
  modelKey: ModelKey,
  values: Record<string, Cell>,
): ShapleyExplanation {
  const model = artifacts.models.get(modelKey);
  if (!model) throw new Error('model-not-found');
  const x = artifacts.pipeline.transformRow(values);
  const blocks = encodedBlocks(artifacts.pipeline);
  const rng = mulberry32(artifacts.seed);

  // Reference rows: a seeded sample of the held-out test matrix.
  const pool = artifacts.testX;
  if (pool.length === 0) throw new Error('no-references');
  const references =
    pool.length <= SHAPLEY_REFERENCES
      ? [...pool]
      : shuffleInPlace(
          pool.map((_, i) => i),
          rng,
        )
          .slice(0, SHAPLEY_REFERENCES)
          .map((i) => pool[i]);

  // The explained output: probability of the predicted class, or the raw value.
  const [predictedIndex] = model.predict([x]);
  const usedProba = artifacts.isClassification && !!model.predictProba;
  const f = (rows: number[][]): number[] => {
    if (!artifacts.isClassification) return model.predict(rows);
    if (model.predictProba) return model.predictProba(rows).map((p) => p[predictedIndex] ?? 0);
    return model.predict(rows).map((p) => (p === predictedIndex ? 1 : 0));
  };

  const [prediction] = f([x]);
  const totals = new Array<number>(blocks.length).fill(0);
  let baselineSum = 0;

  for (let p = 0; p < SHAPLEY_PERMUTATIONS; p++) {
    const order = shuffleInPlace(
      blocks.map((_, i) => i),
      rng,
    );
    // One chain per reference: start from the reference row, flip the explained
    // row's blocks in, one at a time, in this permutation's order.
    const batch: number[][] = [];
    for (const reference of references) {
      const row = [...reference];
      batch.push([...row]);
      for (const blockIndex of order) {
        const block = blocks[blockIndex];
        for (let j = 0; j < block.width; j++) row[block.start + j] = x[block.start + j];
        batch.push([...row]);
      }
    }
    const outputs = f(batch);
    const chain = blocks.length + 1;
    for (let r = 0; r < references.length; r++) {
      const offset = r * chain;
      baselineSum += outputs[offset];
      for (let step = 0; step < order.length; step++) {
        totals[order[step]] += outputs[offset + step + 1] - outputs[offset + step];
      }
    }
  }

  const samples = SHAPLEY_PERMUTATIONS * references.length;
  const contributions = blocks
    .map((block, i) => ({ column: block.column, value: totals[i] / samples }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

  return {
    model: modelKey,
    targetClass: artifacts.isClassification
      ? (artifacts.classes[predictedIndex] ?? String(predictedIndex))
      : undefined,
    usedProba,
    baseline: baselineSum / samples,
    prediction,
    contributions,
    permutations: SHAPLEY_PERMUTATIONS,
    references: references.length,
  };
}

import { describe, expect, it } from 'vitest';
import { profileColumn } from '@/features/ml/data/profile';
import {
  computeInsights,
  computeWhatIf,
  confusionMatrix,
  encodedBlocks,
  permutationImportance,
  residualsHistogram,
  rocCurve,
} from '@/features/ml/train/insights';
import { fitPipeline } from '@/features/ml/train/pipeline';
import { runTraining, type TrainArtifacts } from '@/features/ml/train/trainer';
import type { Cell } from '@/features/ml/data/types';

function setup(data: Record<string, Cell[]>) {
  const columns = new Map(Object.entries(data));
  const profiles = Object.entries(data).map(([name, values]) => profileColumn(name, values));
  return { columns, profiles };
}

const noop = {
  onModelStart: () => undefined,
  onModelResult: () => undefined,
  isCancelled: () => false,
};

describe('confusionMatrix', () => {
  it('counts [true][predicted] cells', () => {
    expect(confusionMatrix([0, 1, 1, 0], [0, 1, 0, 0], 2)).toEqual([
      [2, 0],
      [1, 1],
    ]);
  });
});

describe('rocCurve', () => {
  it('starts at (0,0), ends at (1,1), and matches the AUC', () => {
    const curve = rocCurve([0, 0, 1, 1], [0.1, 0.4, 0.35, 0.8])!;
    expect(curve.auc).toBeCloseTo(0.75, 12);
    expect(curve.points[0]).toEqual({ fpr: 0, tpr: 0 });
    expect(curve.points[curve.points.length - 1]).toEqual({ fpr: 1, tpr: 1 });
  });

  it('returns null for a single-class truth', () => {
    expect(rocCurve([1, 1], [0.2, 0.9])).toBeNull();
  });
});

describe('encodedBlocks', () => {
  it('maps one-hot groups back to their source column', () => {
    const { columns, profiles } = setup({
      x: ['1', '2', '3', '4'],
      c: ['a', 'b', 'a', 'b'],
    });
    const pipeline = fitPipeline(columns, profiles, ['x', 'c'], [0, 1, 2, 3]);
    expect(encodedBlocks(pipeline)).toEqual([
      { column: 'x', start: 0, width: 1 },
      { column: 'c', start: 1, width: 2 },
    ]);
  });
});

describe('residualsHistogram', () => {
  it('covers every residual and collapses constants into one bin', () => {
    const spread = residualsHistogram([1, 2, 3, 10], [1, 1, 1, 1]);
    expect(spread.counts.reduce((a, v) => a + v, 0)).toBe(4);
    expect(residualsHistogram([5, 5], [3, 3])).toEqual({ counts: [2], min: 2, max: 2 });
  });
});

const N = 200;
const f1 = Array.from({ length: N }, (_, i) => String(i));
const f2 = Array.from({ length: N }, (_, i) => String((i * 31) % 17)); // noise vs the target
const label = Array.from({ length: N }, (_, i) => (i < N / 2 ? 'no' : 'yes'));

async function classificationArtifacts(): Promise<TrainArtifacts> {
  const { columns, profiles } = setup({ f1, f2, label });
  const outcome = await runTraining(
    columns,
    profiles,
    { target: 'label', features: ['f1', 'f2'], seed: 42, testRatio: 0.2 },
    noop,
  );
  return outcome!.artifacts;
}

describe('permutationImportance', () => {
  it('ranks the informative column far above the noise column', async () => {
    const artifacts = await classificationArtifacts();
    const model = artifacts.models.get('logistic')!;
    const importance = permutationImportance(
      model,
      artifacts.pipeline,
      artifacts.testX,
      artifacts.testY,
      true,
      42,
    );
    expect(importance[0].column).toBe('f1');
    expect(importance[0].value).toBeGreaterThan(0.2);
    const noise = importance.find((entry) => entry.column === 'f2')!;
    expect(Math.abs(noise.value)).toBeLessThan(0.1);
  });
});

describe('computeInsights / computeWhatIf', () => {
  it('produces a full classification bundle', async () => {
    const artifacts = await classificationArtifacts();
    const insights = computeInsights(artifacts, 'logistic');
    expect(insights.classes).toEqual(['no', 'yes']);
    expect(insights.confusion).toHaveLength(2);
    expect(insights.roc?.auc).toBeGreaterThan(0.95);
    expect(insights.importance[0].column).toBe('f1');
    expect(insights.scatter).toBeUndefined();
  });

  it('answers what-if questions with label and sorted probabilities', async () => {
    const artifacts = await classificationArtifacts();
    const high = computeWhatIf(artifacts, 'logistic', { f1: '190', f2: '3' });
    expect(high.prediction).toBe('yes');
    expect(high.probabilities![0].label).toBe('yes');
    expect(high.probabilities![0].p).toBeGreaterThan(0.5);
    const low = computeWhatIf(artifacts, 'logistic', { f1: '5', f2: '3' });
    expect(low.prediction).toBe('no');
  });

  it('produces regression diagnostics and numeric what-if answers', async () => {
    const y = Array.from({ length: N }, (_, i) => String(3 * i + ((i * 37) % 11) / 10));
    const { columns, profiles } = setup({ f1, f2, y });
    const outcome = await runTraining(
      columns,
      profiles,
      { target: 'y', features: ['f1', 'f2'], seed: 42, testRatio: 0.2 },
      noop,
    );
    const insights = computeInsights(outcome!.artifacts, 'linear');
    expect(insights.scatter!.length).toBeGreaterThan(10);
    expect(insights.residuals!.counts.reduce((a, v) => a + v, 0)).toBe(outcome!.summary.testRows);
    expect(insights.confusion).toBeUndefined();
    const prediction = Number(
      computeWhatIf(outcome!.artifacts, 'linear', { f1: '100', f2: '3' }).prediction,
    );
    expect(prediction).toBeCloseTo(300, -1); // ≈ 3 × 100, within ±5
  });
});

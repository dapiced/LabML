import { describe, expect, it } from 'vitest';
import { bestThresholdByCost } from '@/features/ml/train/threshold';
import { analyzeThresholds, suggestThreshold } from '@/features/ml/train/threshold-analysis';
import type { TrainedModel } from '@/features/ml/train/models';
import type { TrainArtifacts } from '@/features/ml/train/trainer';

// V53: the cost-optimal threshold is a choice, and a choice made on the test
// set is no longer measured by it. The suggestion comes from validation; the
// test pairs only ever grade it.

/** A model whose "features" are already the probability of the positive class. */
const echo = {
  predict: (x: number[][]) => x.map((row) => (row[0] >= 0.5 ? 1 : 0)),
  predictProba: (x: number[][]) => x.map((row) => [1 - row[0], row[0]]),
} as unknown as TrainedModel;

function artifacts(
  validation: [number, number][],
  test: [number, number][],
  classes = ['no', 'yes'],
): TrainArtifacts {
  return {
    models: new Map([['gbdt', echo]]),
    pipeline: {} as TrainArtifacts['pipeline'],
    validationX: validation.map(([p]) => [p]),
    validationY: validation.map(([, y]) => y),
    testX: test.map(([p]) => [p]),
    testY: test.map(([, y]) => y),
    testIndices: test.map((_, i) => i),
    classes,
    isClassification: true,
    seed: 42,
  };
}

// Validation separates cleanly at 0.6; the test set happens to separate at 0.3.
const VALIDATION: [number, number][] = [
  [0.1, 0],
  [0.2, 0],
  [0.4, 0],
  [0.55, 0],
  [0.6, 1],
  [0.8, 1],
  [0.9, 1],
];
const TEST: [number, number][] = [
  [0.05, 0],
  [0.15, 0],
  [0.25, 0],
  [0.3, 1],
  [0.45, 1],
  [0.7, 1],
  [0.95, 1],
];

describe('threshold suggestion (V53)', () => {
  it('carries the validation pairs beside the test pairs', () => {
    const analysis = analyzeThresholds(artifacts(VALIDATION, TEST), 'gbdt')!;
    expect(analysis.pairs).toEqual(TEST);
    expect(analysis.validationPairs).toEqual(VALIDATION);
  });

  it('picks the cut on validation, not on the pairs that grade it', () => {
    const analysis = analyzeThresholds(artifacts(VALIDATION, TEST), 'gbdt')!;
    const onTest = bestThresholdByCost(
      TEST.map(([, y]) => y),
      TEST.map(([p]) => p),
      1,
      1,
    );
    // The test-optimal cut is the one the panel used to offer.
    expect(onTest.threshold).toBeCloseTo(0.3, 10);
    expect(suggestThreshold(analysis, 1, 1)).toBeCloseTo(0.6, 10);
  });

  it('follows the cost matrix', () => {
    const analysis = analyzeThresholds(artifacts(VALIDATION, TEST), 'gbdt')!;
    const noisy: [number, number][] = [...VALIDATION, [0.3, 1]];
    const withMiss = analyzeThresholds(artifacts(noisy, TEST), 'gbdt')!;
    // A missed case priced 10× pulls the cut down to catch the stray positive.
    expect(suggestThreshold(withMiss, 1, 10)).toBeCloseTo(0.3, 10);
    expect(suggestThreshold(withMiss, 10, 1)).toBeCloseTo(0.6, 10);
    expect(suggestThreshold(analysis, 1, 10)).toBeCloseTo(0.6, 10);
  });

  it('refuses to suggest without a validation split', () => {
    const analysis = analyzeThresholds(artifacts([], TEST), 'gbdt')!;
    expect(analysis.validationPairs).toBeUndefined();
    expect(suggestThreshold(analysis, 1, 1)).toBeNull();
  });

  it('refuses to suggest when validation holds a single class', () => {
    const onlyNegatives: [number, number][] = [
      [0.1, 0],
      [0.7, 0],
    ];
    const analysis = analyzeThresholds(artifacts(onlyNegatives, TEST), 'gbdt')!;
    expect(suggestThreshold(analysis, 1, 1)).toBeNull();
  });

  it('binarises the validation labels one-vs-rest on a multiclass run', () => {
    const three = {
      predict: (x: number[][]) => x.map(() => 0),
      predictProba: (x: number[][]) => x.map((row) => [row[0], row[1], 1 - row[0] - row[1]]),
    } as unknown as TrainedModel;
    const art = artifacts([], [], ['a', 'b', 'c']);
    art.models = new Map([['gbdt', three]]);
    art.validationX = [
      [0.8, 0.1],
      [0.2, 0.7],
      [0.1, 0.2],
    ];
    art.validationY = [0, 1, 2];
    art.testX = art.validationX;
    art.testY = [0, 1, 2];
    const analysis = analyzeThresholds(art, 'gbdt', 1)!;
    expect(analysis.validationPairs).toEqual([
      [0.1, 0],
      [0.7, 1],
      [0.2, 0],
    ]);
  });
});

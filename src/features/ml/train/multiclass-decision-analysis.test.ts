import { describe, expect, it, vi } from 'vitest';
import {
  analyzeMulticlassDecision,
  testMulticlassDecision,
} from '@/features/ml/train/multiclass-decision-analysis';
import type { TrainedModel } from '@/features/ml/train/models';
import type { TrainArtifacts } from '@/features/ml/train/trainer';

function artifacts(model: TrainedModel, overrides: Partial<TrainArtifacts> = {}): TrainArtifacts {
  return {
    models: new Map([['logistic', model]]),
    pipeline: {} as TrainArtifacts['pipeline'],
    validationX: [[1], [2]],
    validationY: [0, 2],
    testX: [[9]],
    testY: [2],
    testIndices: [9],
    classes: ['a', 'b', 'c'],
    isClassification: true,
    seed: 42,
    ...overrides,
  };
}

const probabilisticModel: TrainedModel = {
  predict: (rows) => rows.map(() => 0),
  predictProba: (rows) => rows.map(([value]) => (value < 5 ? [0.7, 0.2, 0.1] : [0.1, 0.1, 0.8])),
};

describe('analyzeMulticlassDecision', () => {
  it('returns validation probabilities for a probabilistic multiclass model', () => {
    expect(analyzeMulticlassDecision(artifacts(probabilisticModel), 'logistic')).toEqual({
      model: 'logistic',
      classes: ['a', 'b', 'c'],
      validationProbabilities: [
        [0.7, 0.2, 0.1],
        [0.7, 0.2, 0.1],
      ],
      validationLabels: [0, 2],
    });
  });

  it('refuses binary runs', () => {
    expect(
      analyzeMulticlassDecision(
        artifacts(probabilisticModel, { classes: ['a', 'b'], validationY: [0, 1] }),
        'logistic',
      ),
    ).toBeNull();
  });

  it('refuses models without probabilities', () => {
    expect(
      analyzeMulticlassDecision(artifacts({ predict: (rows) => rows.map(() => 0) }), 'logistic'),
    ).toBeNull();
  });

  it('refuses an empty validation split without reading the test split', () => {
    const predictProba = vi.fn(() => [[0.1, 0.1, 0.8]]);
    const result = analyzeMulticlassDecision(
      artifacts(
        { predict: (rows) => rows.map(() => 0), predictProba },
        { validationX: [], validationY: [] },
      ),
      'logistic',
    );

    expect(result).toBeNull();
    expect(predictProba).not.toHaveBeenCalled();
  });
});

describe('testMulticlassDecision', () => {
  it('returns aggregate test metrics and preserves the exploratory marker', () => {
    const result = testMulticlassDecision(
      artifacts(probabilisticModel),
      'logistic',
      { thresholds: [0.5, 0.5, 0.5] },
      true,
    );

    expect(result.exploratory).toBe(true);
    expect(result.policy).toEqual({ thresholds: [0.5, 0.5, 0.5] });
    expect(result.metrics).toMatchObject({ rows: 1, decided: 1, accuracy: 1 });
    expect(result).not.toHaveProperty('probabilities');
    expect(result).not.toHaveProperty('labels');
  });
});

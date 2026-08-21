import { describe, expect, it } from 'vitest';
import { profileColumn } from '@/features/ml/data/profile';
import { fitPipeline } from './pipeline';
import { explainPrediction } from './shapley';
import type { Cell } from '@/features/ml/data/types';
import type { TrainedModel } from './models';
import type { TrainArtifacts } from './trainer';

/** Real pipeline over two numeric columns; models act on the ENCODED features. */
function makeArtifacts(model: TrainedModel, isClassification: boolean): TrainArtifacts {
  const x1: Cell[] = Array.from({ length: 40 }, (_, i) => String(i % 10));
  const x2: Cell[] = Array.from({ length: 40 }, (_, i) => String((i * 7) % 10));
  const columns = new Map<string, Cell[]>([
    ['x1', x1],
    ['x2', x2],
  ]);
  const profiles = [profileColumn('x1', x1), profileColumn('x2', x2)];
  const indices = Array.from({ length: 40 }, (_, i) => i);
  const pipeline = fitPipeline(columns, profiles, ['x1', 'x2'], indices);
  return {
    models: new Map([[isClassification ? 'logistic' : 'linear', model]]),
    pipeline,
    testX: pipeline.transform(indices.slice(0, 10)),
    testY: [],
    classes: isClassification ? ['no', 'yes'] : [],
    isClassification,
    seed: 42,
  };
}

describe('explainPrediction', () => {
  it('recovers exact linear attributions and the efficiency property', () => {
    const w = [2, -3];
    const bias = 0.5;
    const linear: TrainedModel = {
      predict: (rows) => rows.map((r) => bias + w[0] * r[0] + w[1] * r[1]),
    };
    const artifacts = makeArtifacts(linear, false);
    const values = { x1: '9', x2: '1' };
    const explanation = explainPrediction(artifacts, 'linear', values);

    const x = artifacts.pipeline.transformRow(values);
    const meanRef = [0, 1].map(
      (j) => artifacts.testX.reduce((acc, row) => acc + row[j], 0) / artifacts.testX.length,
    );
    const expected = new Map([
      ['x1', w[0] * (x[0] - meanRef[0])],
      ['x2', w[1] * (x[1] - meanRef[1])],
    ]);
    for (const { column, value } of explanation.contributions) {
      expect(value).toBeCloseTo(expected.get(column)!, 8);
    }
    // Efficiency: contributions telescope to prediction − baseline, exactly.
    const sum = explanation.contributions.reduce((acc, c) => acc + c.value, 0);
    expect(sum).toBeCloseTo(explanation.prediction - explanation.baseline, 8);
    expect(explanation.prediction).toBeCloseTo(bias + w[0] * x[0] + w[1] * x[1], 8);
    expect(explanation.targetClass).toBeUndefined();
  });

  it('explains the predicted class probability and ignores unused features', () => {
    // Probability depends on the first encoded feature only.
    const sigmoid = (v: number) => 1 / (1 + Math.exp(-v));
    const proba = (rows: number[][]) => rows.map((r) => [1 - sigmoid(2 * r[0]), sigmoid(2 * r[0])]);
    const classifier: TrainedModel = {
      predict: (rows) => proba(rows).map((p) => (p[1] > 0.5 ? 1 : 0)),
      predictProba: proba,
    };
    const artifacts = makeArtifacts(classifier, true);
    const explanation = explainPrediction(artifacts, 'logistic', { x1: '9', x2: '1' });

    expect(explanation.targetClass).toBe('yes');
    expect(explanation.usedProba).toBe(true);
    const x2 = explanation.contributions.find((c) => c.column === 'x2')!;
    expect(Math.abs(x2.value)).toBeLessThan(1e-9);
    const sum = explanation.contributions.reduce((acc, c) => acc + c.value, 0);
    expect(sum).toBeCloseTo(explanation.prediction - explanation.baseline, 8);
  });

  it('is deterministic', () => {
    const linear: TrainedModel = { predict: (rows) => rows.map((r) => r[0] * r[1]) };
    const artifacts = makeArtifacts(linear, false);
    const a = explainPrediction(artifacts, 'linear', { x1: '3', x2: '7' });
    const b = explainPrediction(artifacts, 'linear', { x1: '3', x2: '7' });
    expect(a).toEqual(b);
  });
});

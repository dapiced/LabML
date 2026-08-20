import { describe, expect, it } from 'vitest';
import { accuracy } from '@/features/ml/train/metrics';
import { modelZoo, type ModelContext } from '@/features/ml/train/models';

const CLASSIFICATION: ModelContext = { task: 'classification', classCount: 2, seed: 42 };
const REGRESSION: ModelContext = { task: 'regression', classCount: 0, seed: 42 };

/** Two well-separated 2D clusters — every sane classifier should be perfect. */
function clusters() {
  const X: number[][] = [];
  const y: number[] = [];
  for (let i = 0; i < 40; i++) {
    const jitter = ((i * 13) % 7) / 70; // deterministic, no RNG
    X.push([-2 + jitter, -2 - jitter]);
    y.push(0);
    X.push([2 - jitter, 2 + jitter]);
    y.push(1);
  }
  return { X, y };
}

function zooMap(task: 'classification' | 'regression') {
  return new Map(modelZoo(task).map((def) => [def.key, def]));
}

describe('classification zoo', () => {
  const { X, y } = clusters();

  it('lists baseline, logistic, knn, naiveBayes, tree, forest', () => {
    expect(modelZoo('classification').map((d) => d.key)).toEqual([
      'baseline',
      'logistic',
      'knn',
      'naiveBayes',
      'tree',
      'forest',
    ]);
  });

  it('baseline predicts the majority class with class-frequency probabilities', () => {
    const model = zooMap('classification').get('baseline')!.train(X, [0, 0, 0, 1], CLASSIFICATION);
    expect(model.predict([[0, 0]])).toEqual([0]);
    expect(model.predictProba!([[0, 0]])[0][0]).toBeCloseTo(0.75, 12);
  });

  for (const key of ['logistic', 'knn', 'naiveBayes', 'tree', 'forest'] as const) {
    it(`${key} separates two clean clusters perfectly`, () => {
      const model = zooMap('classification').get(key)!.train(X, y, CLASSIFICATION);
      expect(accuracy(y, model.predict(X))).toBe(1);
    });
  }

  it('probabilistic models emit well-formed probabilities', () => {
    for (const key of ['logistic', 'knn', 'naiveBayes'] as const) {
      const model = zooMap('classification').get(key)!.train(X, y, CLASSIFICATION);
      const probs = model.predictProba!([[2, 2]])[0];
      expect(probs).toHaveLength(2);
      expect(probs[0] + probs[1]).toBeCloseTo(1, 9);
      expect(probs[1]).toBeGreaterThan(0.5);
    }
  });

  it('random forest is reproducible for a given seed', () => {
    const def = zooMap('classification').get('forest')!;
    const a = def.train(X, y, CLASSIFICATION).predict(X);
    const b = def.train(X, y, CLASSIFICATION).predict(X);
    expect(a).toEqual(b);
  });
});

describe('regression zoo', () => {
  it('lists baseline, linear, knn, tree, forest', () => {
    expect(modelZoo('regression').map((d) => d.key)).toEqual([
      'baseline',
      'linear',
      'knn',
      'tree',
      'forest',
    ]);
  });

  it('baseline predicts the train mean', () => {
    const model = zooMap('regression')
      .get('baseline')!
      .train([[0], [0], [0]], [1, 2, 3], REGRESSION);
    expect(model.predict([[123]])).toEqual([2]);
  });

  it('linear regression recovers y = 2x + 1 almost exactly', () => {
    const X = Array.from({ length: 20 }, (_, i) => [i]);
    const y = X.map(([x]) => 2 * x + 1);
    const model = zooMap('regression').get('linear')!.train(X, y, REGRESSION);
    const [prediction] = model.predict([[25]]);
    expect(prediction).toBeCloseTo(51, 4);
  });
});

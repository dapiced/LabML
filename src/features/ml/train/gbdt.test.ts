import { describe, expect, it } from 'vitest';
import { trainGbdtClassifier, trainGbdtRegressor } from '@/features/ml/train/gbdt';

/** Deterministic XOR-style interaction: sign(x1 · x2) — unlearnable linearly. */
function interactionData() {
  const X: number[][] = [];
  const y: number[] = [];
  for (let a = 0; a < 20; a++) {
    for (let b = 0; b < 20; b++) {
      const x1 = -1 + (a * 2) / 19;
      const x2 = -1 + (b * 2) / 19;
      X.push([x1, x2]);
      y.push(x1 * x2 > 0 ? 1 : 0);
    }
  }
  return { X, y };
}

describe('gbdt classifier', () => {
  it('learns the XOR interaction a linear model cannot', () => {
    const { X, y } = interactionData();
    const model = trainGbdtClassifier(X, y, 2);
    const probs = model.proba(X);
    const correct = probs.filter((p, i) => (p[1] > 0.5 ? 1 : 0) === y[i]).length;
    expect(correct / y.length).toBeGreaterThan(0.95);
  });

  it('handles three classes one-vs-rest', () => {
    const X = Array.from({ length: 300 }, (_, i) => [i / 100]);
    const y = X.map(([x]) => (x < 1 ? 0 : x < 2 ? 1 : 2));
    const model = trainGbdtClassifier(X, y, 3);
    const predictions = model.proba(X).map((p) => p.indexOf(Math.max(...p)));
    const correct = predictions.filter((p, i) => p === y[i]).length;
    expect(correct / y.length).toBeGreaterThan(0.95);
    for (const p of model.proba([[0.5], [2.5]])) {
      expect(p.reduce((a, v) => a + v, 0)).toBeCloseTo(1, 9);
    }
  });

  it('is deterministic', () => {
    const { X, y } = interactionData();
    const a = trainGbdtClassifier(X, y, 2).proba(X.slice(0, 20));
    const b = trainGbdtClassifier(X, y, 2).proba(X.slice(0, 20));
    expect(a).toEqual(b);
  });
});

describe('gbdt regressor', () => {
  it('fits a smooth non-linear curve far better than the mean', () => {
    const X = Array.from({ length: 200 }, (_, i) => [-1 + (i * 2) / 199]);
    const y = X.map(([x]) => x * x * 10);
    const model = trainGbdtRegressor(X, y);
    const predictions = model.predictRaw(X);
    const mean = y.reduce((a, v) => a + v, 0) / y.length;
    const ssRes = y.reduce((a, v, i) => a + (v - predictions[i]) ** 2, 0);
    const ssTot = y.reduce((a, v) => a + (v - mean) ** 2, 0);
    expect(1 - ssRes / ssTot).toBeGreaterThan(0.97);
  });
});

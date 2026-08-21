import { describe, expect, it } from 'vitest';
import { trainMlp } from '@/features/ml/train/mlp';

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

describe('mlp classification', () => {
  it('solves the XOR interaction', () => {
    const { X, y } = interactionData();
    const model = trainMlp(X, y, 2, 42);
    const probs = model.forward(X);
    const correct = probs.filter((p, i) => (p[1] > 0.5 ? 1 : 0) === y[i]).length;
    expect(correct / y.length).toBeGreaterThan(0.9);
    expect(probs[0][0] + probs[0][1]).toBeCloseTo(1, 9);
  });

  it('is deterministic for a seed, and seed-sensitive', () => {
    const { X, y } = interactionData();
    const sample = X.slice(0, 10);
    const a = trainMlp(X, y, 2, 42).forward(sample);
    const b = trainMlp(X, y, 2, 42).forward(sample);
    const c = trainMlp(X, y, 2, 7).forward(sample);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});

describe('mlp regression', () => {
  it('fits a parabola with high R²', () => {
    const X = Array.from({ length: 200 }, (_, i) => [-1 + (i * 2) / 199]);
    const y = X.map(([x]) => x * x * 10);
    const model = trainMlp(X, y, 0, 42);
    const predictions = model.forward(X).map((p) => p[0]);
    const mean = y.reduce((a, v) => a + v, 0) / y.length;
    const ssRes = y.reduce((a, v, i) => a + (v - predictions[i]) ** 2, 0);
    const ssTot = y.reduce((a, v) => a + (v - mean) ** 2, 0);
    expect(1 - ssRes / ssTot).toBeGreaterThan(0.9);
  });
});

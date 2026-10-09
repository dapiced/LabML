import { describe, expect, it } from 'vitest';
import { profileColumn } from '@/features/ml/data/profile';
import { accuracy, logLoss, macroPrf, mae, r2, rmse } from '@/features/ml/train/metrics';
import { evaluateMulticlassPolicy } from '@/features/ml/train/multiclass-decision';
import { splitIndices } from '@/features/ml/train/pipeline';
import { runTraining } from '@/features/ml/train/trainer';
import type { Cell } from '@/features/ml/data/types';

/**
 * V50 — three edges where a metric flattered or punished by accident. Each
 * expectation below failed on the code before V50; the measurement is in
 * PLAN.md under the V50 row.
 */
describe('macro averages count only the classes present', () => {
  it('scores a perfect batch that holds two of three classes as perfect', () => {
    // Before: 0.667 — the absent third class was averaged in as a zero.
    expect(macroPrf([0, 0, 1, 1], [0, 0, 1, 1], 3)).toEqual({ precision: 1, recall: 1, f1: 1 });
  });

  it('applies the same rule to the multiclass decision policy', () => {
    const probabilities = [
      [0.9, 0.05, 0.05],
      [0.8, 0.1, 0.1],
      [0.1, 0.85, 0.05],
      [0.05, 0.9, 0.05],
    ];
    const metrics = evaluateMulticlassPolicy([0, 0, 1, 1], probabilities, {
      thresholds: [0, 0, 0],
    });
    expect(metrics.macroF1).toBe(1);
  });
});

describe('a metric over nothing is not a result', () => {
  it('returns NaN rather than a perfect or a null score', () => {
    // Before: RMSE 0, MAE 0 and R² 1 — a perfect model, measured on nothing.
    for (const value of [
      accuracy([], []),
      logLoss([], []),
      rmse([], []),
      mae([], []),
      r2([], []),
    ]) {
      expect(value).toBeNaN();
    }
    expect(macroPrf([], [], 3).f1).toBeNaN();
  });
});

describe('a rare class is learned before it is tested', () => {
  const split = (rare: number) => {
    const rows = Array.from({ length: 100 + rare }, (_, i) => i);
    const labels = rows.map((i) => (i < 100 ? (i % 2 ? 'a' : 'b') : 'rare'));
    const first = splitIndices(rows, labels, 0.2, 42);
    const second = splitIndices(
      first.train,
      first.train.map((i) => labels[i]),
      0.2,
      43,
    );
    const count = (indices: number[]) => indices.filter((i) => i >= 100).length;
    return { test: count(first.test), validation: count(second.test), train: count(second.train) };
  };

  it('keeps a one-row class for training', () => {
    // Before: test 1, train 0 — the models never saw an example of it.
    expect(split(1)).toEqual({ test: 0, validation: 0, train: 1 });
  });

  it('keeps one row of a two-row class for training', () => {
    // Before: test 1, validation 1, train 0.
    expect(split(2)).toEqual({ test: 1, validation: 0, train: 1 });
  });

  it('leaves larger classes exactly where they were', () => {
    expect(split(5)).toEqual({ test: 1, validation: 1, train: 3 });
  });

  it('refuses by name when nothing is left to test on', async () => {
    const data: Record<string, Cell[]> = {
      x: ['1', '2', '3', '4'],
      label: ['a', 'b', 'c', 'd'],
    };
    const columns = new Map(Object.entries(data));
    const profiles = Object.entries(data).map(([name, values]) => profileColumn(name, values));
    await expect(
      runTraining(
        columns,
        profiles,
        { target: 'label', features: ['x'], seed: 42, testRatio: 0.2 },
        { onModelStart: () => undefined, onModelResult: () => undefined, isCancelled: () => false },
      ),
    ).rejects.toThrow('too-few-rows');
  });
});

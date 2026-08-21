import { describe, expect, it } from 'vitest';
import { profileColumn } from '@/features/ml/data/profile';
import {
  curveSizes,
  runLearningCurve,
  stepVerdict,
  type LearningCurveOutcome,
} from '@/features/ml/train/learning-curve';
import { MODEL_TRAIN_CAPS } from '@/features/ml/train/models';
import type { Cell, ColumnProfile } from '@/features/ml/data/types';
import type { ModelKey } from '@/features/ml/train/types';

describe('curveSizes', () => {
  it('builds an ascending geometric ladder ending exactly at max', () => {
    const sizes = curveSizes(2_000, 16);
    expect(sizes[sizes.length - 1]).toBe(2_000);
    expect(sizes.length).toBeGreaterThanOrEqual(4);
    expect(sizes.length).toBeLessThanOrEqual(6);
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeGreaterThan(sizes[i - 1]);
    expect(sizes.every((s) => s >= 16)).toBe(true);
  });

  it('drops rungs under the floor instead of training on noise', () => {
    // 120 train rows with floor 16: 8 and 13 disappear, the curve keeps 4 points.
    expect(curveSizes(120, 16)).toEqual([23, 40, 69, 120]);
  });

  it('degenerates to a single point on tiny data (the caller refuses)', () => {
    expect(curveSizes(20, 16)).toEqual([20]);
  });
});

describe('stepVerdict', () => {
  const seed = 42;
  it('calls a decisive paired gain "climbing"', () => {
    // 200 test rows: the bigger sample fixes 40 mistakes and loses none.
    const previous = Array.from({ length: 200 }, (_, i) => (i < 120 ? 1 : 0));
    const last = Array.from({ length: 200 }, (_, i) => (i < 160 ? 1 : 0));
    const verdict = stepVerdict(last, previous, true, seed);
    expect(verdict.kind).toBe('climbing');
    expect(verdict.gain).toBeCloseTo(0.2, 10);
    expect(verdict.lo).toBeGreaterThan(0);
    expect(verdict.winShare).toBeGreaterThan(0.99);
  });

  it('calls identical losses a plateau', () => {
    const losses = Array.from({ length: 200 }, (_, i) => (i % 5 === 0 ? 0 : 1));
    const verdict = stepVerdict([...losses], [...losses], true, seed);
    expect(verdict.kind).toBe('plateau');
    expect(verdict.gain).toBe(0);
  });

  it('orients regression gains as "lower RMSE is better"', () => {
    const previous = Array.from({ length: 200 }, () => 4); // rmse 2
    const last = Array.from({ length: 200 }, () => 1); // rmse 1
    const verdict = stepVerdict(last, previous, false, seed);
    expect(verdict.kind).toBe('climbing');
    expect(verdict.gain).toBeCloseTo(1, 10);
  });
});

function dataset(n: number): { columns: Map<string, Cell[]>; profiles: ColumnProfile[] } {
  const cols: Record<string, Cell[]> = { x1: new Array(n), x2: new Array(n), label: new Array(n) };
  for (let i = 0; i < n; i++) {
    const x1 = i % 97;
    const x2 = (i * 13) % 41;
    cols.x1[i] = String(x1);
    cols.x2[i] = String(x2);
    // A circular boundary: axis-aligned learners need many splits to trace
    // it, so small samples score poorly and the curve genuinely climbs.
    cols.label[i] = (x1 - 48) ** 2 + (x2 * 2.4 - 48) ** 2 < 38 ** 2 ? 'yes' : 'no';
  }
  return {
    columns: new Map(Object.entries(cols)),
    profiles: Object.entries(cols).map(([name, values]) => profileColumn(name, values)),
  };
}

async function curve(n: number, model: ModelKey): Promise<LearningCurveOutcome | null> {
  const { columns, profiles } = dataset(n);
  return runLearningCurve(
    columns,
    profiles,
    { target: 'label', features: ['x1', 'x2'], seed: 42, testRatio: 0.2 },
    model,
    { onProgress: () => undefined, isCancelled: () => false },
  );
}

describe('runLearningCurve', () => {
  it('trains gbdt on nested prefixes and improves along the curve', async () => {
    const outcome = (await curve(2_600, 'gbdt'))!;
    expect(outcome.model).toBe('gbdt');
    expect(outcome.metricLabel).toBe('accuracy');
    expect(outcome.cappedAt).toBeUndefined();
    const sizes = outcome.points.map((p) => p.rows);
    expect(sizes[sizes.length - 1]).toBe(outcome.trainRows);
    // The learnable rule: the full-size point clearly beats the smallest one.
    const first = outcome.points[0];
    const last = outcome.points[outcome.points.length - 1];
    expect(last.metric).toBeGreaterThan(first.metric);
    expect(last.lo).toBeLessThanOrEqual(last.metric);
    expect(last.hi).toBeGreaterThanOrEqual(last.metric);
    // Deterministic: the same seed rebuilds the same curve.
    const again = (await curve(2_600, 'gbdt'))!;
    expect(again.points.map((p) => ({ ...p, trainMs: 0 }))).toEqual(
      outcome.points.map((p) => ({ ...p, trainMs: 0 })),
    );
  }, 60_000);

  it('stops the curve at an announced family cap and says so', async () => {
    const outcome = (await curve(2_600, 'forest'))!;
    expect(outcome.cappedAt).toBe(MODEL_TRAIN_CAPS.forest);
    const last = outcome.points[outcome.points.length - 1];
    expect(last.rows).toBe(MODEL_TRAIN_CAPS.forest);
    expect(outcome.trainRows).toBeGreaterThan(MODEL_TRAIN_CAPS.forest!);
  }, 60_000);

  it('refuses the baseline — its curve is flat by definition', async () => {
    expect(await curve(2_600, 'baseline')).toBeNull();
  }, 60_000);

  it('refuses a dataset whose ladder has a single rung — one point is not a curve', async () => {
    const n = 25;
    const cols: Record<string, Cell[]> = {
      x1: Array.from({ length: n }, (_, i) => String(i % 5)),
      x2: Array.from({ length: n }, (_, i) => String(i % 3)),
      label: Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 'yes' : 'no')),
    };
    const outcome = await runLearningCurve(
      new Map(Object.entries(cols)),
      Object.entries(cols).map(([name, values]) => profileColumn(name, values)),
      { target: 'label', features: ['x1', 'x2'], seed: 42, testRatio: 0.2 },
      'tree',
      { onProgress: () => undefined, isCancelled: () => false },
    );
    expect(outcome).toBeNull();
  });
});

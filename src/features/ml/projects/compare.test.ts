import { describe, expect, it } from 'vitest';
import { compareRuns } from '@/features/ml/projects/compare';
import type { TaskType } from '@/features/ml/data/types';
import type { RunRecord } from '@/features/ml/projects/types';
import type { ModelKey, ModelResult } from '@/features/ml/train/types';

function result(key: ModelKey, primary: number, ok = true): ModelResult {
  return { key, ok, metrics: {}, primary, trainMs: 1, inferP50Ms: 0, inferP95Ms: 0 };
}

function makeRun(options: {
  taskType?: TaskType;
  target?: string;
  dataset?: string;
  features: string[];
  results: ModelResult[];
  winnerInterval?: { model: ModelKey; point: number; lo: number; hi: number };
}): RunRecord {
  const taskType = options.taskType ?? 'binary';
  return {
    name: 'run',
    createdAt: 0,
    dataset: { name: options.dataset ?? 'demo.csv', rowCount: 100, columnCount: 5 },
    target: options.target ?? 'label',
    taskType,
    seed: 42,
    results: options.results,
    summary: {
      task: { type: taskType },
      taskType,
      seed: 42,
      trainRows: 80,
      testRows: 20,
      featureCount: options.features.length,
      featureColumns: options.features,
      skippedColumns: [],
      totalMs: 10,
    },
    insights: { model: options.results[0].key, importance: [] },
    ...(options.winnerInterval
      ? {
          artifacts: {
            uncertainty: {
              isClassification: taskType !== 'regression',
              metricLabel: taskType !== 'regression' ? 'accuracy' : 'rmse',
              testRows: 20,
              resamples: 1000,
              seed: 42,
              intervals: [options.winnerInterval],
              verdict: null,
            },
          },
        }
      : {}),
  };
}

describe('compareRuns', () => {
  it('diffs the feature sets and orients the classification delta', () => {
    const a = makeRun({
      features: ['age', 'fare', 'leak'],
      results: [result('gbdt', 0.9), result('baseline', 0.6)],
    });
    const b = makeRun({
      features: ['age', 'fare', 'deck'],
      results: [result('forest', 0.94), result('baseline', 0.6)],
    });
    const diff = compareRuns(a, b);
    expect(diff.comparable).toBe(true);
    expect(diff.features).toEqual({ added: ['deck'], removed: ['leak'], kept: ['age', 'fare'] });
    expect(diff.best).toMatchObject({
      a: { key: 'gbdt', primary: 0.9 },
      b: { key: 'forest', primary: 0.94 },
      improved: true,
    });
    expect(diff.best!.delta).toBeCloseTo(0.04, 10);
    // Union of keys, B's ranking first; models missing on one side get null.
    expect(diff.models.map((m) => m.key)).toEqual(['forest', 'gbdt', 'baseline']);
    expect(diff.models[0]).toEqual({ key: 'forest', a: null, b: 0.94, delta: null });
    expect(diff.models[2].delta).toBeCloseTo(0, 10);
  });

  it('orients RMSE the other way: lower is an improvement', () => {
    const a = makeRun({
      taskType: 'regression',
      features: ['x'],
      results: [result('linear', 3.2)],
    });
    const b = makeRun({
      taskType: 'regression',
      features: ['x'],
      results: [result('linear', 2.8)],
    });
    const diff = compareRuns(a, b);
    expect(diff.metricLabel).toBe('rmse');
    expect(diff.best!.delta).toBeCloseTo(-0.4, 10);
    expect(diff.best!.improved).toBe(true);
  });

  it('refuses metric deltas across targets or task families', () => {
    const a = makeRun({ features: ['x'], results: [result('gbdt', 0.9)] });
    const other = makeRun({
      target: 'price',
      taskType: 'regression',
      features: ['x'],
      results: [result('linear', 2)],
    });
    const diff = compareRuns(a, other);
    expect(diff.comparable).toBe(false);
    expect(diff.models).toEqual([]);
    expect(diff.best).toBeNull();
    expect(diff.intervals).toBeNull();
    // The config diff still tells the story.
    expect(diff.sameTarget).toBe(false);
  });

  it('reads interval overlap from both winners, and only when both exist', () => {
    const withA = {
      features: ['x'],
      results: [result('gbdt', 0.9)],
      winnerInterval: { model: 'gbdt' as ModelKey, point: 0.9, lo: 0.85, hi: 0.95 },
    };
    const disjoint = makeRun({
      features: ['x'],
      results: [result('forest', 0.99)],
      winnerInterval: { model: 'forest' as ModelKey, point: 0.99, lo: 0.97, hi: 1 },
    });
    const overlapping = makeRun({
      features: ['x'],
      results: [result('forest', 0.93)],
      winnerInterval: { model: 'forest' as ModelKey, point: 0.93, lo: 0.88, hi: 0.98 },
    });
    expect(compareRuns(makeRun(withA), disjoint).intervals!.overlap).toBe(false);
    expect(compareRuns(makeRun(withA), overlapping).intervals!.overlap).toBe(true);
    expect(
      compareRuns(makeRun(withA), makeRun({ features: ['x'], results: [result('forest', 0.9)] }))
        .intervals,
    ).toBeNull();
  });
});

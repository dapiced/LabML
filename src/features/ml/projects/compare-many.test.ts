import { describe, expect, it } from 'vitest';
import { compareMany, MAX_RUNS } from '@/features/ml/projects/compare-many';
import type { RunRecord } from '@/features/ml/projects/types';
import type { ModelKey } from '@/features/ml/train/types';

// V37: N runs, read against the oldest. Not a second diff engine — the same
// ranking rule and the same feature lists, in a wider shape.

function run(
  id: number,
  createdAt: number,
  scores: Partial<Record<ModelKey, number>>,
  features: string[] = ['a', 'b'],
  over: Partial<RunRecord> = {},
): RunRecord {
  return {
    id,
    name: `run ${id}`,
    createdAt,
    dataset: { name: 'demo.csv', rowCount: 100, columnCount: 3 },
    target: 'label',
    taskType: 'binary',
    seed: 42,
    results: Object.entries(scores).map(([key, value]) => ({
      key: key as ModelKey,
      ok: true,
      metrics: { accuracy: value as number },
      primary: value as number,
      valPrimary: value as number,
      valMetrics: { accuracy: value as number },
      trainMs: 0,
      inferP50Ms: 0,
      inferP95Ms: 0,
    })),
    summary: { featureColumns: features } as RunRecord['summary'],
    insights: {} as RunRecord['insights'],
    artifacts: {},
    ...over,
  } as RunRecord;
}

describe('compareMany (V37)', () => {
  it('refuses fewer than two and more than six runs', () => {
    expect(compareMany([run(1, 1, { tree: 0.8 })])).toBeNull();
    const many = Array.from({ length: MAX_RUNS + 1 }, (_, i) => run(i, i, { tree: 0.8 }));
    expect(compareMany(many)).toBeNull();
  });

  it('reads every run against the OLDEST, whatever the selection order', () => {
    const a = run(1, 100, { tree: 0.7, gbdt: 0.75 });
    const b = run(2, 200, { tree: 0.72, gbdt: 0.8 });
    const c = run(3, 300, { tree: 0.6, gbdt: 0.65 });
    const cmp = compareMany([c, a, b])!; // deliberately out of order
    expect(cmp.referenceId).toBe(1);
    expect(cmp.columns.map((col) => col.id)).toEqual([1, 2, 3]);
    expect(cmp.columns[0].delta).toBeNull(); // the reference has no delta
    expect(cmp.columns[1].delta).toBeCloseTo(0.05, 10); // 0.80 − 0.75
    expect(cmp.columns[2].delta).toBeCloseTo(-0.1, 10); // 0.65 − 0.75
  });

  it('names the leader — the run whose champion is best', () => {
    const cmp = compareMany([
      run(1, 100, { gbdt: 0.75 }),
      run(2, 200, { gbdt: 0.8 }),
      run(3, 300, { gbdt: 0.65 }),
    ])!;
    expect(cmp.leaderId).toBe(2);
  });

  it('picks the LOWEST champion on regression', () => {
    const rmse = (id: number, at: number, value: number) =>
      run(id, at, { gbdt: value }, ['a', 'b'], { taskType: 'regression' });
    const cmp = compareMany([rmse(1, 100, 5), rmse(2, 200, 3), rmse(3, 300, 8)])!;
    expect(cmp.isClassification).toBe(false);
    expect(cmp.leaderId).toBe(2);
  });

  it('builds a matrix with a hole where a model did not run', () => {
    const cmp = compareMany([
      run(1, 100, { tree: 0.7, gbdt: 0.75 }),
      run(2, 200, { gbdt: 0.8, mlp: 0.9 }),
    ])!;
    const byKey = new Map(cmp.models.map((m) => [m.key, m.values]));
    expect(byKey.get('tree')).toEqual([0.7, null]);
    expect(byKey.get('mlp')).toEqual([null, 0.9]);
    expect(byKey.get('gbdt')).toEqual([0.75, 0.8]);
  });

  it('orders the matrix by the reference run own ranking', () => {
    const cmp = compareMany([
      run(1, 100, { tree: 0.6, gbdt: 0.9, mlp: 0.75 }),
      run(2, 200, { tree: 0.99 }),
    ])!;
    // gbdt led the reference, so it leads the table — not the newest winner.
    expect(cmp.models.map((m) => m.key)).toEqual(['gbdt', 'mlp', 'tree']);
  });

  it('reports feature moves against the reference, and the shared core', () => {
    const cmp = compareMany([
      run(1, 100, { gbdt: 0.7 }, ['a', 'b', 'c']),
      run(2, 200, { gbdt: 0.8 }, ['a', 'b', 'd']),
      run(3, 300, { gbdt: 0.9 }, ['a', 'd']),
    ])!;
    expect(cmp.columns[1].added).toEqual(['d']);
    expect(cmp.columns[1].removed).toEqual(['c']);
    expect(cmp.sharedFeatures).toEqual(['a']);
  });

  it('refuses to call numbers deltas when the targets differ', () => {
    const cmp = compareMany([
      run(1, 100, { gbdt: 0.7 }),
      run(2, 200, { gbdt: 0.8 }, ['a', 'b'], { target: 'autre' }),
    ])!;
    expect(cmp.comparable).toBe(false);
    expect(cmp.columns[1].delta).toBeNull();
    expect(cmp.leaderId).toBeNull();
  });

  it('ranks on the chosen metric, like every other surface (V36)', () => {
    const withRecall = (id: number, at: number, acc: number, recall: number): RunRecord => {
      const r = run(id, at, { gbdt: acc });
      r.results[0].valMetrics = { accuracy: acc, recall };
      r.results[0].metrics = { accuracy: acc, recall };
      return r;
    };
    const onAccuracy = compareMany([withRecall(1, 100, 0.9, 0.1), withRecall(2, 200, 0.8, 0.9)])!;
    expect(onAccuracy.leaderId).toBe(1);
    const onRecall = compareMany(
      [withRecall(1, 100, 0.9, 0.1), withRecall(2, 200, 0.8, 0.9)],
      'recall',
    )!;
    expect(onRecall.leaderId).toBe(2);
  });
});

import { describe, expect, it } from 'vitest';
import { profileColumn } from '@/features/ml/data/profile';
import { MODEL_TRAIN_CAPS } from '@/features/ml/train/models';
import { nestedSampleOrder } from '@/features/ml/train/random';
import {
  GLOBAL_SAMPLE_CAP,
  prepareData,
  runTraining,
  type TrainOutcome,
} from '@/features/ml/train/trainer';
import type { ModelResult } from '@/features/ml/train/types';
import type { Cell, ColumnProfile } from '@/features/ml/data/types';

// V25: sampling is ANNOUNCED, seeded and nested — these tests freeze all three.

describe('nestedSampleOrder', () => {
  it('is a deterministic permutation of 0..count-1', () => {
    const a = nestedSampleOrder(500, null, 42);
    const b = nestedSampleOrder(500, null, 42);
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual(Array.from({ length: 500 }, (_, i) => i));
    expect(nestedSampleOrder(500, null, 43)).not.toEqual(a);
  });

  it('keeps every prefix stratified: a 10% class gets exactly its share', () => {
    // 900 'a' + 100 'b': the quantile placement makes a 100-prefix hold 10 'b'.
    const labels = Array.from({ length: 1000 }, (_, i) => (i % 10 === 0 ? 'b' : 'a'));
    const order = nestedSampleOrder(1000, labels, 42);
    const prefix = order.slice(0, 100);
    expect(prefix.filter((i) => labels[i] === 'b')).toHaveLength(10);
    // Nested: the 50-prefix is a subset of the 100-prefix by construction.
    expect(new Set(prefix)).toSatisfy((s: Set<number>) =>
      order.slice(0, 50).every((i) => s.has(i)),
    );
  });
});

function bigDataset(n: number): { columns: Map<string, Cell[]>; profiles: ColumnProfile[] } {
  const x1: Cell[] = new Array(n);
  const x2: Cell[] = new Array(n);
  const label: Cell[] = new Array(n);
  for (let i = 0; i < n; i++) {
    x1[i] = String(i % 97);
    x2[i] = String((i * 13) % 41);
    // Learnable rule: the label is a threshold on x1 + x2 (~30% 'yes').
    label[i] = (i % 97) + ((i * 13) % 41) > 85 ? 'yes' : 'no';
  }
  const source: Record<string, Cell[]> = { x1, x2, label };
  return {
    columns: new Map(Object.entries(source)),
    profiles: Object.entries(source).map(([name, values]) => profileColumn(name, values)),
  };
}

describe('prepareData — announced global sample (V25)', () => {
  it('caps 120k usable rows at exactly 100 000, says so, and stays stratified', () => {
    const { columns, profiles } = bigDataset(120_000);
    const config = { target: 'label', features: ['x1', 'x2'], seed: 42, testRatio: 0.2 };
    const prepared = prepareData(columns, profiles, config);
    expect(prepared.sampledFrom).toBe(120_000);
    expect(prepared.train.length + prepared.test.length).toBe(GLOBAL_SAMPLE_CAP);
    // The class balance survives the sample (quantile stratification).
    const labels = columns.get('label')!;
    const yesTotal = labels.filter((v) => v === 'yes').length;
    const expected = Math.round((yesTotal * GLOBAL_SAMPLE_CAP) / 120_000);
    const yes = [...prepared.train, ...prepared.test].filter((i) => labels[i] === 'yes').length;
    expect(Math.abs(yes - expected)).toBeLessThanOrEqual(5);
    // Deterministic: the same seed picks the same rows.
    const again = prepareData(columns, profiles, config);
    expect(again.train).toEqual(prepared.train);
    expect(again.test).toEqual(prepared.test);
  });

  it('leaves datasets at or under the cap untouched (no silent sampling)', () => {
    const { columns, profiles } = bigDataset(5_000);
    const prepared = prepareData(columns, profiles, {
      target: 'label',
      features: ['x1', 'x2'],
      seed: 42,
      testRatio: 0.2,
    });
    expect(prepared.sampledFrom).toBeUndefined();
    expect(prepared.train.length + prepared.test.length).toBe(5_000);
  });
});

async function trainOn(
  n: number,
  seed = 42,
): Promise<{
  outcome: TrainOutcome;
  results: Map<ModelResult['key'], ModelResult>;
}> {
  const { columns, profiles } = bigDataset(n);
  const results = new Map<ModelResult['key'], ModelResult>();
  const outcome = await runTraining(
    columns,
    profiles,
    { target: 'label', features: ['x1', 'x2'], seed, testRatio: 0.2 },
    {
      onModelStart: () => undefined,
      onModelResult: (r) => results.set(r.key, r),
      isCancelled: () => false,
    },
  );
  return { outcome: outcome!, results };
}

describe('runTraining — announced per-family caps (V25)', () => {
  it('records the exact trainedRows for capped and uncapped families alike', async () => {
    // 2 600 rows -> 2 080 train: tree (2 000) and forest (1 000) engage, the rest do not.
    const { outcome, results } = await trainOn(2_600);
    const trainRows = outcome.summary.trainRows;
    expect(trainRows).toBeGreaterThan(2_000); // tree's cap must actually engage
    expect(outcome.summary.sampledFrom).toBeUndefined();
    expect(results.get('forest')!.trainedRows).toBe(MODEL_TRAIN_CAPS.forest);
    expect(results.get('tree')!.trainedRows).toBe(MODEL_TRAIN_CAPS.tree);
    for (const key of ['baseline', 'logistic', 'knn', 'naiveBayes', 'gbdt', 'mlp'] as const) {
      expect(results.get(key)!.trainedRows, key).toBe(trainRows);
    }
    // Deterministic: the same seed trains the capped families on the same rows.
    const repeat = await trainOn(2_600);
    expect(repeat.results.get('forest')!.metrics).toEqual(results.get('forest')!.metrics);
    expect(repeat.results.get('tree')!.metrics).toEqual(results.get('tree')!.metrics);
  }, 60_000);

  it('caps k-NN at 5 000 announced rows — the old silent subsample is gone', async () => {
    // 7 000 rows -> 5 600 train: knn (5 000) engages on top of tree and forest.
    const { outcome, results } = await trainOn(7_000);
    expect(results.get('knn')!.trainedRows).toBe(MODEL_TRAIN_CAPS.knn);
    expect(results.get('gbdt')!.trainedRows).toBe(outcome.summary.trainRows);
    // Capped families still beat the baseline on this separable dataset —
    // the sample is a training diet, not a lobotomy.
    expect(results.get('forest')!.primary).toBeGreaterThan(results.get('baseline')!.primary);
  }, 60_000);
});

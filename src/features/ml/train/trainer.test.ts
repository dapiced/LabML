import { describe, expect, it } from 'vitest';
import { profileColumn } from '@/features/ml/data/profile';
import { runTraining, type TrainerCallbacks } from '@/features/ml/train/trainer';
import type { Cell } from '@/features/ml/data/types';
import type { ModelResult, TrainConfig } from '@/features/ml/train/types';

function setup(data: Record<string, Cell[]>) {
  const columns = new Map(Object.entries(data));
  const profiles = Object.entries(data).map(([name, values]) => profileColumn(name, values));
  return { columns, profiles };
}

function collector(cancelled = () => false) {
  const results: ModelResult[] = [];
  const callbacks: TrainerCallbacks = {
    onModelStart: () => undefined,
    onModelResult: (result) => results.push(result),
    isCancelled: cancelled,
  };
  return { results, callbacks };
}

const N = 200;
const f1 = Array.from({ length: N }, (_, i) => String(i));
const f2 = Array.from({ length: N }, (_, i) => (i % 2 === 0 ? 'u' : 'v'));
const note = Array.from({ length: N }, (_, i) => `free text row ${i}`);

describe('runTraining — classification', () => {
  const label = Array.from({ length: N }, (_, i) => (i < N / 2 ? 'no' : 'yes'));
  const { columns, profiles } = setup({ f1, f2, note, label });
  const config: TrainConfig = {
    target: 'label',
    features: ['f1', 'f2', 'note'],
    seed: 42,
    testRatio: 0.2,
  };

  it('trains the full zoo, beats the baseline, and reports the run', async () => {
    const { results, callbacks } = collector();
    const outcome = await runTraining(columns, profiles, config, callbacks);
    expect(outcome).not.toBeNull();
    const summary = outcome!.summary;
    expect(results).toHaveLength(8);
    expect(results.every((r) => r.ok)).toBe(true);

    const baseline = results.find((r) => r.key === 'baseline')!;
    expect(baseline.metrics.accuracy).toBeCloseTo(0.5, 1);
    const best = Math.max(...results.map((r) => r.metrics.accuracy ?? 0));
    expect(best).toBeGreaterThan(0.9); // the target is separable on f1

    expect(summary.taskType).toBe('binary');
    expect(summary.trainRows + summary.testRows).toBe(N);
    expect(summary.featureColumns).toEqual(['f1', 'f2']);
    expect(summary.skippedColumns).toEqual(['note']); // free text is not trainable yet
    expect(outcome!.artifacts.models.size).toBe(8);
    expect(outcome!.artifacts.testY).toHaveLength(summary.testRows);
  });

  it('is reproducible: same seed, same metrics', async () => {
    const a = collector();
    const b = collector();
    await runTraining(columns, profiles, config, a.callbacks);
    await runTraining(columns, profiles, config, b.callbacks);
    expect(a.results.map((r) => [r.key, r.primary, r.metrics])).toEqual(
      b.results.map((r) => [r.key, r.primary, r.metrics]),
    );
  });

  it('stops between models when cancelled', async () => {
    const { results, callbacks } = collector(() => results.length >= 2);
    const outcome = await runTraining(columns, profiles, config, callbacks);
    expect(outcome).toBeNull();
    expect(results.length).toBeLessThan(8);
  });
});

describe('runTraining — regression', () => {
  const y = Array.from({ length: N }, (_, i) => String(3 * i + ((i * 37) % 11) / 10));
  const { columns, profiles } = setup({ f1, f2, y });
  const config: TrainConfig = { target: 'y', features: ['f1', 'f2'], seed: 42, testRatio: 0.2 };

  it('trains the regression zoo and the linear model nails the linear signal', async () => {
    const { results, callbacks } = collector();
    const outcome = await runTraining(columns, profiles, config, callbacks);
    expect(outcome!.summary.taskType).toBe('regression');
    expect(results).toHaveLength(7);
    expect(results.every((r) => r.ok)).toBe(true);
    const linear = results.find((r) => r.key === 'linear')!;
    expect(linear.metrics.r2!).toBeGreaterThan(0.99);
    const baseline = results.find((r) => r.key === 'baseline')!;
    expect(baseline.metrics.r2!).toBeLessThan(0.1);
  });
});

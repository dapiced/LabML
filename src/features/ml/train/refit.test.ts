import { describe, expect, it } from 'vitest';
import { profileColumn } from '@/features/ml/data/profile';
import { refitOnAllRows } from '@/features/ml/train/refit';
import { prepareData } from '@/features/ml/train/trainer';
import type { Cell } from '@/features/ml/data/types';
import type { TrainConfig } from '@/features/ml/train/types';

// V65: the family fitted again on every labelled row. It repeats the run's
// configuration, sees the rows the run held out, and is deterministic.

const N = 200;
const size = Array.from({ length: N }, (_, i) => String((i * 37) % 101));
// A category only the last rows carry: some splits never show it to training.
const kind = Array.from({ length: N }, (_, i) => (i >= N - 3 ? 'rare' : i % 2 === 0 ? 'u' : 'v'));
const label = size.map((value) => (Number(value) > 50 ? 'yes' : 'no'));
const price = size.map((value, i) => String(Number(value) * 2 + (i % 5)));

function setup(data: Record<string, Cell[]>) {
  const columns = new Map(Object.entries(data));
  const profiles = Object.entries(data).map(([name, values]) => profileColumn(name, values));
  return { columns, profiles };
}

const classification: TrainConfig = {
  target: 'label',
  features: ['size', 'kind'],
  seed: 42,
  testRatio: 0.2,
};

describe('refitOnAllRows', () => {
  const { columns, profiles } = setup({ size, kind, label });

  it('fits on every labelled row, the held-out ones included', () => {
    const prepared = prepareData(columns, profiles, classification);
    const refit = refitOnAllRows(columns, profiles, classification, 'tree')!;
    expect(refit.rows).toBe(N);
    expect(refit.fittedRows).toBe(N);
    expect(prepared.train.length).toBeLessThan(N);
    expect(refit.classes).toEqual(prepared.classes);
    expect(refit.isClassification).toBe(true);
  });

  it('leaves out the rows with no label, as the run does', () => {
    const holes = label.map((value, i) => (i % 10 === 0 ? '' : value));
    const data = setup({ size, kind, label: holes });
    const refit = refitOnAllRows(data.columns, data.profiles, classification, 'tree')!;
    expect(refit.rows).toBe(N - N / 10);
  });

  it('gives the same model twice', () => {
    const first = refitOnAllRows(columns, profiles, classification, 'forest')!;
    const second = refitOnAllRows(columns, profiles, classification, 'forest')!;
    const rows = Array.from({ length: N }, (_, i) => i);
    expect(second.model.predict(second.pipeline.transform(rows))).toEqual(
      first.model.predict(first.pipeline.transform(rows)),
    );
  });

  it('learns the rule from all the rows', () => {
    const refit = refitOnAllRows(columns, profiles, classification, 'tree')!;
    const rows = Array.from({ length: N }, (_, i) => i);
    const predicted = refit.model.predict(refit.pipeline.transform(rows));
    const right = predicted.filter((value, i) => refit.classes[value] === label[i]).length;
    expect(right / N).toBeGreaterThan(0.95);
  });

  it('keeps the shape the scorer expects: the same source columns', () => {
    const refit = refitOnAllRows(columns, profiles, classification, 'logistic')!;
    expect([...new Set(refit.pipeline.specs.map((spec) => spec.name))].sort()).toEqual([
      'kind',
      'size',
    ]);
    const encoded = refit.pipeline.transformRow({ size: '12', kind: 'never seen' });
    expect(encoded.every((value) => Number.isFinite(value))).toBe(true);
  });

  it('fits a regression too, and refuses a family the task does not have', () => {
    const data = setup({ size, kind, price });
    const regression: TrainConfig = { ...classification, target: 'price' };
    const refit = refitOnAllRows(data.columns, data.profiles, regression, 'linear')!;
    expect(refit.isClassification).toBe(false);
    expect(refit.rows).toBe(N);
    expect(refitOnAllRows(data.columns, data.profiles, regression, 'logistic')).toBeNull();
    expect(refitOnAllRows(columns, profiles, classification, 'linear')).toBeNull();
  });
});

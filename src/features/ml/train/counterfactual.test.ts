import { describe, expect, it } from 'vitest';
import { profileColumn } from '@/features/ml/data/profile';
import {
  counterfactualsFor,
  observedValues,
  searchCounterfactuals,
  type Answer,
  type CandidateColumn,
  type SearchInput,
} from '@/features/ml/train/counterfactual';
import { runTraining, type TrainArtifacts } from '@/features/ml/train/trainer';
import type { Cell } from '@/features/ml/data/types';

// V68: the smallest change that flips the model, among values the training
// rows hold, leaving locked columns alone, and saying so when nothing flips.

const columns: CandidateColumn[] = [
  { name: 'income', kind: 'numeric', values: ['20', '30', '40', '50', '60', '70'], scale: 10 },
  { name: 'age', kind: 'numeric', values: ['20', '30', '40', '50'], scale: 10 },
  { name: 'city', kind: 'category', values: ['paris', 'lyon', 'nice'] },
];

/** A rule the test can read: yes when income >= 50, or when in nice and aged 40 or more. */
function rule(row: Record<string, string>): Answer {
  const yes = Number(row.income) >= 50 || (row.city === 'nice' && Number(row.age) >= 40);
  return { label: yes ? 1 : 0, probability: yes ? 0.8 : 0.7 };
}

function input(over: Partial<SearchInput> = {}): SearchInput {
  return {
    values: { income: '30', age: '40', city: 'paris' },
    columns,
    locked: new Set(),
    current: 0,
    target: null,
    predict: (rows) => rows.map(rule),
    ...over,
  };
}

describe('observedValues', () => {
  it('keeps the distinct numbers in order, one per value, both ends included', () => {
    expect(observedValues(['3', '1', '', null, '2', '3.0', 'x', '1'], 'numeric', 10)).toEqual([
      '1',
      '2',
      '3',
    ]);
    const many = Array.from({ length: 101 }, (_, i) => String(i));
    const picked = observedValues(many, 'numeric', 5);
    expect(picked).toEqual(['0', '25', '50', '75', '100']);
  });

  it('gives the categories most frequent first, capped', () => {
    expect(observedValues(['b', 'a', 'b', 'c', 'a', 'b', ' '], 'category', 2)).toEqual(['b', 'a']);
  });
});

describe('searchCounterfactuals', () => {
  it('finds the nearest value of each column that flips, smallest change first', () => {
    const result = searchCounterfactuals(input());
    expect(result.columnsChanged).toBe(1);
    expect(result.found.map((item) => item.changes)).toEqual([
      [{ column: 'city', from: 'paris', to: 'nice' }],
      [{ column: 'income', from: '30', to: '50' }],
    ]);
    expect(result.found[0].distance).toBe(1);
    expect(result.found[1].distance).toBe(2);
    expect(result.found[0]).toMatchObject({ prediction: 1, probability: 0.8 });
    // Age alone flips nothing here, and is not invented.
    expect(result.found.some((item) => item.changes[0].column === 'age')).toBe(false);
  });

  it('returns only changes that do flip the model', () => {
    const result = searchCounterfactuals(input());
    for (const item of result.found) {
      const row = { ...input().values };
      for (const change of item.changes) row[change.column] = change.to;
      expect(rule(row).label).toBe(item.prediction);
      expect(item.prediction).not.toBe(0);
    }
  });

  it('never changes a locked column', () => {
    const result = searchCounterfactuals(input({ locked: new Set(['city']) }));
    expect(result.found.map((item) => item.changes[0].column)).toEqual(['income']);
    expect(result.tried.locked).toEqual(['city']);
    expect(result.tried.columns).toEqual(['income', 'age']);
  });

  it('tries two columns only when no single one flips', () => {
    const result = searchCounterfactuals(
      input({ values: { income: '30', age: '20', city: 'paris' }, locked: new Set(['income']) }),
    );
    expect(result.columnsChanged).toBe(2);
    expect(result.tried.pairs).toBe(true);
    expect(result.found).toHaveLength(1);
    expect(result.found[0].changes).toEqual([
      { column: 'age', from: '20', to: '40' },
      { column: 'city', from: 'paris', to: 'nice' },
    ]);
    expect(result.found[0].distance).toBe(3);
  });

  it('says so when nothing flips, with what was tried', () => {
    const result = searchCounterfactuals(
      input({ predict: (rows) => rows.map(() => ({ label: 0 })) }),
    );
    expect(result.found).toEqual([]);
    expect(result.columnsChanged).toBe(0);
    expect(result.tried.rows).toBeGreaterThan(10);
    const allLocked = searchCounterfactuals(input({ locked: new Set(['income', 'age', 'city']) }));
    expect(allLocked.found).toEqual([]);
    expect(allLocked.tried.columns).toEqual([]);
    expect(allLocked.tried.rows).toBe(0);
  });

  it('only tries values the training rows hold', () => {
    const seen: Record<string, string>[] = [];
    searchCounterfactuals(
      input({
        predict: (rows) => {
          seen.push(...rows);
          return rows.map(() => ({ label: 0 }));
        },
      }),
    );
    for (const row of seen) {
      for (const column of columns) {
        expect([...column.values, input().values[column.name]]).toContain(row[column.name]);
      }
    }
  });

  it('reaches the class asked for, not just any other', () => {
    const three = (row: Record<string, string>): Answer => ({
      label: Number(row.income) >= 60 ? 2 : Number(row.income) >= 40 ? 1 : 0,
    });
    const any = searchCounterfactuals(input({ predict: (rows) => rows.map(three) }));
    expect(any.found[0].changes[0]).toMatchObject({ column: 'income', to: '40' });
    expect(any.found[0].prediction).toBe(1);
    const wanted = searchCounterfactuals(input({ predict: (rows) => rows.map(three), target: 2 }));
    expect(wanted.found[0].changes[0]).toMatchObject({ column: 'income', to: '60' });
    expect(wanted.found[0].prediction).toBe(2);
  });

  it('prefers a change that still looks like a training row, and flags the one that does not', () => {
    // Nice is declared far: income becomes the first answer, nice has no other value and is flagged.
    const result = searchCounterfactuals(
      input({ far: (row) => row.city === 'nice' || row.income === '50' }),
    );
    expect(result.found.map((item) => [item.changes[0].to, item.far])).toEqual([
      ['60', false],
      ['nice', true],
    ]);
  });

  it('gives the same answer twice', () => {
    expect(searchCounterfactuals(input())).toEqual(searchCounterfactuals(input()));
  });
});

describe('counterfactualsFor', () => {
  const N = 240;
  const income = Array.from({ length: N }, (_, i) => String(20 + ((i * 53) % 90)));
  const age = Array.from({ length: N }, (_, i) => String(18 + ((i * 37) % 60)));
  const city = Array.from({ length: N }, (_, i) => ['paris', 'lyon', 'nice'][(i * 7) % 3]);
  const note = Array.from({ length: N }, (_, i) => `free words about row number ${i} here`);
  const label = income.map((value) => (Number(value) >= 65 ? 'yes' : 'no'));
  const amount = income.map((value, i) => String(Number(value) * 2 + (i % 3)));

  async function run(target: string, data: Record<string, Cell[]>) {
    const table = new Map(Object.entries(data));
    const profiles = Object.entries(data).map(([name, cells]) => profileColumn(name, cells));
    const outcome = await runTraining(
      table,
      profiles,
      { target, features: ['income', 'age', 'city', 'note'], seed: 3, testRatio: 0.2 },
      { onModelStart() {}, onModelResult() {}, isCancelled: () => false },
    );
    return { artifacts: outcome!.artifacts as TrainArtifacts, table };
  }

  it('flips the inspected model with values of the file, reads the other models, and leaves text alone', async () => {
    const { artifacts, table } = await run('label', { income, age, city, note, label });
    const values = { income: '30', age: '40', city: 'paris', note: 'free words' };
    const cache = {};
    for (const key of ['tree', 'logistic', 'gbdt', 'knn'] as const) {
      const payload = counterfactualsFor(artifacts, key, values, [], null, table, cache)!;
      expect(artifacts.classes[payload.current]).toBe('no');
      expect(payload.untouched).toEqual(['note']);
      expect(payload.found.length).toBeGreaterThan(0);
      const model = artifacts.models.get(key)!;
      for (const item of payload.found) {
        const changed: Record<string, string> = { ...values };
        for (const change of item.changes) {
          changed[change.column] = change.to;
          expect(change.column).not.toBe('note');
          expect(table.get(change.column)).toContain(change.to);
        }
        expect(model.predict([artifacts.pipeline.transformRow(changed)])[0]).toBe(item.prediction);
        expect(artifacts.classes[item.prediction]).toBe('yes');
        expect(item.followed.by).toBeLessThanOrEqual(item.followed.of);
        expect(typeof item.far).toBe('boolean');
      }
      // The rule is on income: the first change is on income, and it is a real one.
      expect(payload.found[0].changes[0].column).toBe('income');
      expect(Number(payload.found[0].changes[0].to)).toBeGreaterThan(30);
    }
  });

  it('leaves a locked column alone and says which', async () => {
    const { artifacts, table } = await run('label', { income, age, city, note, label });
    const values = { income: '30', age: '40', city: 'paris', note: 'free words' };
    const payload = counterfactualsFor(artifacts, 'tree', values, ['income'], null, table)!;
    expect(payload.tried.locked).toEqual(['income']);
    for (const item of payload.found) {
      expect(item.changes.some((change) => change.column === 'income')).toBe(false);
    }
  });

  it('has nothing to say of a regression, and refuses a model that is not there', async () => {
    const { artifacts, table } = await run('amount', { income, age, city, note, amount });
    const values = { income: '30', age: '40', city: 'paris', note: 'x' };
    expect(counterfactualsFor(artifacts, 'tree', values, [], null, table)).toBeNull();
    const classification = await run('label', { income, age, city, note, label });
    expect(() =>
      counterfactualsFor(
        { ...classification.artifacts, models: new Map() },
        'tree',
        values,
        [],
        null,
        classification.table,
      ),
    ).toThrow('model-not-found');
  });
});

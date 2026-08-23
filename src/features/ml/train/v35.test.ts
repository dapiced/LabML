import { describe, expect, it } from 'vitest';
import { profileColumn } from '@/features/ml/data/profile';
import { leakScan } from '@/features/ml/train/leakage';
import { splitIndices } from '@/features/ml/train/pipeline';
import { bestResult, championGap, rankingValue, sortResults } from '@/features/ml/train/ranking';
import { robustRank } from '@/features/ml/train/robust';
import { MIN_ROWS_FOR_VALIDATION, prepareData, runTraining } from '@/features/ml/train/trainer';
import type { ModelResult, TrainConfig } from '@/features/ml/train/types';
import type { Cell, ColumnProfile } from '@/features/ml/data/types';

// V35: the number stops flattering itself. These tests freeze the three-way
// split (with its compatibility guarantee: the TEST indices are the same ones
// the two-way split produced), the announced chronological and group splits,
// the predictive leak scan, and the 5×2 robust ranking.

function setup(data: Record<string, Cell[]>): {
  columns: Map<string, Cell[]>;
  profiles: ColumnProfile[];
} {
  const columns = new Map(Object.entries(data));
  const profiles = Object.entries(data).map(([name, values]) => profileColumn(name, values));
  return { columns, profiles };
}

/** n rows, learnable rule, ~35% positive class. */
function classification(n: number): Record<string, Cell[]> {
  const x1: Cell[] = [];
  const x2: Cell[] = [];
  const label: Cell[] = [];
  for (let i = 0; i < n; i++) {
    x1.push(String(i % 23));
    x2.push(String((i * 7) % 19));
    label.push((i % 23) + ((i * 7) % 19) > 26 ? 'yes' : 'no');
  }
  return { x1, x2, label };
}

const config = (over: Partial<TrainConfig> = {}): TrainConfig => ({
  target: 'label',
  features: ['x1', 'x2'],
  seed: 42,
  testRatio: 0.2,
  ...over,
});

describe('prepareData — the third split (V35)', () => {
  it('keeps the test indices byte-identical to the pre-V35 two-way split', () => {
    const data = classification(200);
    const { columns, profiles } = setup(data);
    const prepared = prepareData(columns, profiles, config());

    const rows = Array.from({ length: 200 }, (_, i) => i);
    const labels = rows.map((i) => (data.label[i] as string).trim());
    const legacy = splitIndices(rows, labels, 0.2, 42);
    expect(prepared.test).toEqual(legacy.test);
  });

  it('partitions rows: train, validation and test are disjoint and complete', () => {
    const { columns, profiles } = setup(classification(200));
    const prepared = prepareData(columns, profiles, config());
    expect(prepared.validation.length).toBeGreaterThan(0);
    const all = [...prepared.train, ...prepared.validation, ...prepared.test].sort((a, b) => a - b);
    expect(all).toEqual(Array.from({ length: 200 }, (_, i) => i));
  });

  it('refuses the third split by name below the minimum row count', () => {
    const { columns, profiles } = setup(classification(MIN_ROWS_FOR_VALIDATION - 10));
    const prepared = prepareData(columns, profiles, config());
    expect(prepared.validation).toEqual([]);
    // Tiny runs keep the historical two-way behaviour.
    expect(prepared.train.length + prepared.test.length).toBe(MIN_ROWS_FOR_VALIDATION - 10);
  });

  it('is deterministic: the same config reproduces the same three splits', () => {
    const { columns, profiles } = setup(classification(150));
    const a = prepareData(columns, profiles, config());
    const b = prepareData(columns, profiles, config());
    expect(a.train).toEqual(b.train);
    expect(a.validation).toEqual(b.validation);
    expect(a.test).toEqual(b.test);
  });
});

describe('prepareData — announced chronological split (V35)', () => {
  function dated(n: number): Record<string, Cell[]> {
    const base = classification(n);
    const when: Cell[] = [];
    for (let i = 0; i < n; i++) {
      const day = new Date(Date.UTC(2024, 0, 1) + i * 86_400_000);
      when.push(day.toISOString().slice(0, 10));
    }
    return { ...base, when };
  }

  it('trains on the oldest rows, validates on the middle, tests on the newest', () => {
    const { columns, profiles } = setup(dated(200));
    const prepared = prepareData(
      columns,
      profiles,
      config({ split: { mode: 'chronological', column: 'when' } }),
    );
    // Rows are indexed in date order, so index order IS time order here.
    expect(Math.max(...prepared.train)).toBeLessThan(Math.min(...prepared.validation));
    expect(Math.max(...prepared.validation)).toBeLessThan(Math.min(...prepared.test));
    expect(prepared.splitInfo).toEqual({ mode: 'chronological', column: 'when' });
  });

  it('drops rows without a parseable date — counted, never silent', () => {
    const data = dated(100);
    data.when[10] = 'not a date';
    data.when[20] = null;
    const { columns, profiles } = setup(data);
    const prepared = prepareData(
      columns,
      profiles,
      config({ split: { mode: 'chronological', column: 'when' } }),
    );
    expect(prepared.splitInfo?.dropped).toBe(2);
    const all = [...prepared.train, ...prepared.validation, ...prepared.test];
    expect(all).toHaveLength(98);
    expect(all).not.toContain(10);
    expect(all).not.toContain(20);
  });
});

describe('prepareData — announced group split (V35)', () => {
  it('never puts two rows of the same group on different sides', () => {
    const base = classification(200);
    const customer: Cell[] = [];
    for (let i = 0; i < 200; i++) customer.push(`c${Math.floor(i / 5)}`);
    const { columns, profiles } = setup({ ...base, customer });
    const prepared = prepareData(
      columns,
      profiles,
      config({ split: { mode: 'group', column: 'customer' } }),
    );
    const side = new Map<string, string>();
    const check = (rows: number[], name: string) => {
      for (const row of rows) {
        const key = customer[row] as string;
        const seen = side.get(key);
        expect(seen === undefined || seen === name).toBe(true);
        side.set(key, name);
      }
    };
    check(prepared.train, 'train');
    check(prepared.validation, 'validation');
    check(prepared.test, 'test');
    expect(prepared.test.length).toBeGreaterThan(0);
    expect(prepared.splitInfo).toEqual({ mode: 'group', column: 'customer' });
  });
});

describe('leakScan (V35)', () => {
  it('flags a column that mirrors the target and spares an honest one', () => {
    const data = classification(300);
    // The leak: a perfect copy of the target under another name.
    data.mirror = data.label.map((v) => (v === 'yes' ? 'oui' : 'non'));
    const { columns, profiles } = setup(data);
    const prepared = prepareData(columns, profiles, config({ features: ['x1', 'x2', 'mirror'] }));
    const warnings = leakScan(
      columns,
      profiles,
      ['x1', 'x2', 'mirror'],
      prepared.train,
      prepared.validation,
      prepared.encode,
      true,
    );
    expect(warnings.map((w) => w.column)).toEqual(['mirror']);
    expect(warnings[0].score).toBe(1);
  });

  it('flags a numeric column that reads a regression target through its bins', () => {
    const n = 400;
    const x: Cell[] = [];
    const leak: Cell[] = [];
    const y: Cell[] = [];
    for (let i = 0; i < n; i++) {
      const value = (i * 37) % 199;
      x.push(String(i % 7));
      leak.push(String(value + 0.01 * ((i * 13) % 5)));
      y.push(String(value));
    }
    const { columns, profiles } = setup({ x, leak, y });
    const prepared = prepareData(columns, profiles, {
      target: 'y',
      features: ['x', 'leak'],
      seed: 42,
      testRatio: 0.2,
    });
    const warnings = leakScan(
      columns,
      profiles,
      ['x', 'leak'],
      prepared.train,
      prepared.validation,
      prepared.encode,
      false,
    );
    expect(warnings.map((w) => w.column)).toEqual(['leak']);
    expect(warnings[0].score).toBeGreaterThanOrEqual(0.99);
  });

  it('refuses to scan when the evaluation split is too small to mean anything', () => {
    const data = classification(40);
    data.mirror = [...data.label];
    const { columns, profiles } = setup(data);
    const prepared = prepareData(columns, profiles, config({ features: ['x1', 'mirror'] }));
    expect(prepared.validation).toEqual([]);
    const warnings = leakScan(
      columns,
      profiles,
      ['x1', 'mirror'],
      prepared.train,
      prepared.validation,
      prepared.encode,
      true,
    );
    expect(warnings).toEqual([]);
  });
});

describe('ranking (V35)', () => {
  const result = (over: Partial<ModelResult>): ModelResult => ({
    key: 'tree',
    ok: true,
    metrics: {},
    primary: 0,
    trainMs: 0,
    inferP50Ms: 0,
    inferP95Ms: 0,
    ...over,
  });

  it('ranks on validation when present, on test otherwise', () => {
    const a = result({ key: 'tree', primary: 0.9, valPrimary: 0.7 });
    const b = result({ key: 'forest', primary: 0.8, valPrimary: 0.85 });
    expect(rankingValue(a)).toBe(0.7);
    expect(sortResults([a, b], 'binary')[0].key).toBe('forest');
    // Pre-V35 stored runs: no validation scores, historical order preserved.
    const legacy = [result({ key: 'tree', primary: 0.9 }), result({ key: 'knn', primary: 0.8 })];
    expect(bestResult(legacy, 'binary')?.key).toBe('tree');
  });

  it('reports the champion selection-vs-test gap only when validation exists', () => {
    const a = result({ key: 'gbdt', primary: 0.78, valPrimary: 0.82 });
    const gap = championGap([a], 'binary');
    expect(gap?.val).toBe(0.82);
    expect(gap?.test).toBe(0.78);
    expect(gap?.gap).toBeCloseTo(-0.04, 12);
    expect(championGap([result({ primary: 0.9 })], 'binary')).toBeNull();
  });

  it('regression ranks low RMSE first on the validation value', () => {
    const a = result({ key: 'linear', primary: 4, valPrimary: 5 });
    const b = result({ key: 'gbdt', primary: 6, valPrimary: 3 });
    expect(sortResults([a, b], 'regression')[0].key).toBe('gbdt');
  });
});

describe('runTraining carries the V35 fields end to end', () => {
  it('emits validation scores, announces the split and warns on a leak', async () => {
    const data = classification(240);
    data.mirror = [...data.label];
    const { columns, profiles } = setup(data);
    const results: ModelResult[] = [];
    const outcome = await runTraining(
      columns,
      profiles,
      config({ features: ['x1', 'x2', 'mirror'] }),
      {
        onModelStart: () => {},
        onModelResult: (r) => results.push(r),
        isCancelled: () => false,
      },
    );
    expect(outcome).not.toBeNull();
    expect(outcome!.summary.validationRows).toBeGreaterThan(0);
    expect(outcome!.summary.leakWarnings?.map((w) => w.column)).toEqual(['mirror']);
    for (const r of results.filter((r) => r.ok)) {
      expect(r.valPrimary).toBeGreaterThanOrEqual(0);
      expect(r.valMetrics?.accuracy).toBe(r.valPrimary);
    }
    // The champion's headline pair exists and is internally consistent.
    const gap = championGap(results, 'binary');
    expect(gap).not.toBeNull();
    expect(gap!.gap).toBeCloseTo(gap!.test - gap!.val, 12);
  }, 30_000);
});

describe('robustRank — 5×2 CV (V35)', () => {
  it('is deterministic, never touches the test rows, and reports the top pair', async () => {
    const { columns, profiles } = setup(classification(200));
    const cfg = config();
    const run = () =>
      robustRank(columns, profiles, cfg, { onProgress: () => {}, isCancelled: () => false }, 2);
    const a = await run();
    const b = await run();
    expect(a).not.toBeNull();
    expect(a!.entries.map((e) => e.model)).toEqual(b!.entries.map((e) => e.model));
    expect(a!.entries[0].scores).toEqual(b!.entries[0].scores);
    expect(a!.entries[0].scores).toHaveLength(4); // 2 reps × 2 halves
    expect(a!.entries[0].sd).toBeGreaterThanOrEqual(0);
    // Pool = train + validation only: the 40 test rows stay out.
    expect(a!.rows).toBe(160);
    expect(a!.topPair).not.toBeNull();
    expect(a!.topPair!.folds).toBe(4);
  }, 60_000);

  it('honours cancellation', async () => {
    const { columns, profiles } = setup(classification(200));
    let calls = 0;
    const outcome = await robustRank(columns, profiles, config(), {
      onProgress: () => {},
      isCancelled: () => calls++ > 3,
    });
    expect(outcome).toBeNull();
  }, 30_000);
});

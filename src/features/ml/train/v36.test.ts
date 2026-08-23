import { describe, expect, it } from 'vitest';
import { profileColumn } from '@/features/ml/data/profile';
import { balancedResample, balancedWeights, majorityShare } from '@/features/ml/train/class-weight';
import { buildEnsemble, planEnsemble } from '@/features/ml/train/ensemble';
import { defaultMetric, rankableMetrics, sortResults } from '@/features/ml/train/ranking';
import { analyzeThresholds } from '@/features/ml/train/threshold-analysis';
import { runTraining, type TrainArtifacts } from '@/features/ml/train/trainer';
import type { TrainedModel } from '@/features/ml/train/models';
import type { ModelKey, ModelResult, TrainConfig } from '@/features/ml/train/types';
import type { Cell, ColumnProfile } from '@/features/ml/data/types';

// V36: the gaps V16 deliberately left open — class weighting, the ranking
// metric, multiclass thresholds — plus the ensemble that costs nothing.

function setup(data: Record<string, Cell[]>): {
  columns: Map<string, Cell[]>;
  profiles: ColumnProfile[];
} {
  const columns = new Map(Object.entries(data));
  const profiles = Object.entries(data).map(([name, values]) => profileColumn(name, values));
  return { columns, profiles };
}

/**
 * ~8% positives whose signal OVERLAPS the common class — the shape class
 * weighting exists for. A cleanly separable rare class needs no weighting;
 * an overlapping one is where an unweighted model quietly answers "no".
 */
function imbalanced(n: number): Record<string, Cell[]> {
  const x1: Cell[] = [];
  const x2: Cell[] = [];
  const label: Cell[] = [];
  for (let i = 0; i < n; i++) {
    const rare = i % 12 === 0;
    // Ranges overlap heavily: rare sits at 30–49, common spans 0–39.
    x1.push(String(rare ? 30 + (i % 20) : i % 40));
    x2.push(String((i * 7) % 23));
    label.push(rare ? 'yes' : 'no');
  }
  return { x1, x2, label };
}

describe('class weighting (V36)', () => {
  it('gives every class the same total mass, and 1 to an absent class', () => {
    const y = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1]; // 8 / 2
    const w = balancedWeights(y, 2);
    expect(w[0] * 8).toBeCloseTo(w[1] * 2, 10);
    expect(balancedWeights([0, 0, 0], 2)[1]).toBe(1);
  });

  it('reports the majority share', () => {
    expect(majorityShare([0, 0, 0, 0, 1], 2)).toBeCloseTo(0.8, 10);
    expect(majorityShare([], 2)).toBe(0);
  });

  it('resamples to a balanced order, deterministically, keeping every row once', () => {
    const y = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1];
    const a = balancedResample(y, 2, 42);
    const b = balancedResample(y, 2, 42);
    expect(a).toEqual(b);
    const counts = [0, 0];
    for (const i of a) counts[y[i]] += 1;
    expect(counts[0]).toBe(counts[1]); // balanced by repetition
    // The minority is upsampled to the majority's size — the majority is
    // never trimmed, so every original row still appears at least once.
    expect(counts[0]).toBe(8);
    for (let i = 0; i < y.length; i++) expect(a).toContain(i);
    expect(balancedResample(y, 2, 43)).not.toEqual(a);
  });

  it('is a no-op when a single class is present — nothing to balance', () => {
    const y = [0, 0, 0];
    expect(balancedResample(y, 2, 42)).toEqual([0, 1, 2]);
  });

  it('lifts recall on the rare class when turned on', async () => {
    const { columns, profiles } = setup(imbalanced(400));
    const base: TrainConfig = {
      target: 'label',
      features: ['x1', 'x2'],
      seed: 42,
      testRatio: 0.2,
    };
    const run = async (cfg: TrainConfig) => {
      const results: ModelResult[] = [];
      const outcome = await runTraining(columns, profiles, cfg, {
        onModelStart: () => {},
        onModelResult: (r) => results.push(r),
        isCancelled: () => false,
      });
      return { results, summary: outcome!.summary };
    };

    const plain = await run(base);
    const weighted = await run({ ...base, classWeighting: 'balanced' });

    // The run announces the imbalance and the weighting — never inferred.
    expect(plain.summary.imbalanced).toBe(true);
    expect(plain.summary.majorityShare).toBeGreaterThan(0.8);
    expect(plain.summary.classWeighting).toBeUndefined();
    expect(weighted.summary.classWeighting).toBe('balanced');

    // Recall is what weighting buys. Measured across the four families that
    // implement it — at least one must improve, and none of them may collapse
    // to "never predict the rare class", which is the failure mode itself.
    const recallOf = (rs: ModelResult[], key: ModelKey) =>
      rs.find((r) => r.key === key)?.metrics.recall ?? 0;
    const weightable: ModelKey[] = ['logistic', 'tree', 'forest', 'gbdt'];
    const gains = weightable.map(
      (key) => recallOf(weighted.results, key) - recallOf(plain.results, key),
    );
    expect(Math.max(...gains)).toBeGreaterThan(0);
    expect(gains.every((g) => g >= -0.05)).toBe(true);
  }, 60_000);
});

describe('ranking metric (V36)', () => {
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

  it('offers the metrics the task actually computes', () => {
    expect(rankableMetrics('binary')).toContain('auc');
    expect(rankableMetrics('multiclass')).not.toContain('auc');
    expect(rankableMetrics('regression')).toEqual(['rmse', 'mae', 'r2']);
    expect(defaultMetric('regression')).toBe('rmse');
    expect(defaultMetric('binary')).toBe('accuracy');
  });

  it('changes the order — the whole point on an imbalanced problem', () => {
    // A majority-class predictor: high accuracy, no recall at all.
    const lazy = result({
      key: 'tree',
      primary: 0.9,
      valPrimary: 0.9,
      valMetrics: { accuracy: 0.9, recall: 0 },
    });
    const useful = result({
      key: 'gbdt',
      primary: 0.8,
      valPrimary: 0.8,
      valMetrics: { accuracy: 0.8, recall: 0.75 },
    });
    expect(sortResults([lazy, useful], 'binary')[0].key).toBe('tree');
    expect(sortResults([lazy, useful], 'binary', 'accuracy')[0].key).toBe('tree');
    expect(sortResults([lazy, useful], 'binary', 'recall')[0].key).toBe('gbdt');
  });

  it('sorts a model that cannot produce the metric last, never drops it', () => {
    const withAuc = result({ key: 'gbdt', valMetrics: { auc: 0.7 } });
    const without = result({ key: 'knn', valMetrics: {} });
    const order = sortResults([without, withAuc], 'binary', 'auc');
    expect(order.map((r) => r.key)).toEqual(['gbdt', 'knn']);
    expect(order).toHaveLength(2);
  });

  it('respects each metric direction, inside one regression run', () => {
    const a = result({ key: 'linear', valMetrics: { rmse: 2, r2: 0.5 } });
    const b = result({ key: 'gbdt', valMetrics: { rmse: 3, r2: 0.9 } });
    expect(sortResults([a, b], 'regression', 'rmse')[0].key).toBe('linear');
    expect(sortResults([a, b], 'regression', 'r2')[0].key).toBe('gbdt');
  });
});

describe('ensemble (V36)', () => {
  const model = (answers: number[], proba?: number[][]): TrainedModel => ({
    predict: () => answers,
    ...(proba !== undefined && { predictProba: () => proba }),
  });
  const result = (key: ModelKey, valPrimary: number): ModelResult => ({
    key,
    ok: true,
    metrics: {},
    primary: valPrimary,
    valPrimary,
    trainMs: 0,
    inferP50Ms: 0,
    inferP95Ms: 0,
  });

  it('never takes the baseline as a member, and picks the top three', () => {
    const results = [
      result('baseline', 0.99),
      result('gbdt', 0.9),
      result('forest', 0.88),
      result('tree', 0.8),
      result('knn', 0.7),
    ];
    const models = new Map<ModelKey, TrainedModel>(
      results.map((r) => [r.key, model([0])] as const),
    );
    const plan = planEnsemble(results, 'binary', models)!;
    expect(plan.members).toEqual(['gbdt', 'forest', 'tree']);
    expect(plan.members).not.toContain('baseline');
  });

  it('refuses by name when fewer than two real candidates exist', () => {
    const results = [result('baseline', 0.9), result('tree', 0.8)];
    const models = new Map<ModelKey, TrainedModel>([['tree', model([0])]]);
    expect(planEnsemble(results, 'binary', models)).toBeNull();
  });

  it('averages probabilities when every member has them', () => {
    const models = new Map<ModelKey, TrainedModel>([
      ['gbdt', model([1], [[0.2, 0.8]])],
      ['forest', model([0], [[0.6, 0.4]])],
    ]);
    const plan = planEnsemble([result('gbdt', 0.9), result('forest', 0.8)], 'binary', models)!;
    expect(plan.method).toBe('probability');
    const built = buildEnsemble(plan, models, 2);
    expect(built.predictProba!([[0]])[0]).toEqual([0.4, 0.6000000000000001]);
    expect(built.predict([[0]])).toEqual([1]);
  });

  it('skips a member with no probabilities rather than dropping to a vote', () => {
    // k-NN outranks tree here, but taking it would cost the ensemble its
    // probabilities — and with them the threshold and calibration panels.
    const models = new Map<ModelKey, TrainedModel>([
      ['gbdt', model([1], [[0.2, 0.8]])],
      ['knn', model([0])], // no predictProba
      ['tree', model([0], [[0.7, 0.3]])],
    ]);
    const plan = planEnsemble(
      [result('gbdt', 0.9), result('knn', 0.85), result('tree', 0.8)],
      'binary',
      models,
    )!;
    expect(plan.method).toBe('probability');
    expect(plan.members).toEqual(['gbdt', 'tree']);
    expect(buildEnsemble(plan, models, 2).predictProba).toBeDefined();
  });

  it('falls back to a majority vote only when probabilities are truly scarce', () => {
    const models = new Map<ModelKey, TrainedModel>([
      ['gbdt', model([1], [[0.2, 0.8]])],
      ['knn', model([0])],
      ['tree', model([0])], // neither knn nor tree can express a confidence
    ]);
    const plan = planEnsemble(
      [result('gbdt', 0.9), result('knn', 0.85), result('tree', 0.8)],
      'binary',
      models,
    )!;
    expect(plan.method).toBe('vote');
    // Two of three vote 0 — the majority, not the leader's answer.
    expect(buildEnsemble(plan, models, 2).predict([[0]])).toEqual([0]);
  });

  it('averages predictions on regression', () => {
    const models = new Map<ModelKey, TrainedModel>([
      ['gbdt', model([10])],
      ['linear', model([20])],
    ]);
    const plan = planEnsemble([result('gbdt', 1), result('linear', 2)], 'regression', models)!;
    expect(plan.method).toBe('mean');
    expect(buildEnsemble(plan, models, 0).predict([[0]])).toEqual([15]);
  });
});

describe('multiclass thresholds — one-vs-rest (V36)', () => {
  function artifacts(): TrainArtifacts {
    const proba = [
      [0.7, 0.2, 0.1],
      [0.1, 0.8, 0.1],
      [0.2, 0.1, 0.7],
      [0.6, 0.3, 0.1],
      [0.1, 0.7, 0.2],
      [0.3, 0.1, 0.6],
      [0.8, 0.1, 0.1],
      [0.2, 0.6, 0.2],
    ];
    const model: TrainedModel = {
      predict: () => proba.map((p) => p.indexOf(Math.max(...p))),
      predictProba: () => proba,
    };
    return {
      models: new Map<ModelKey, TrainedModel>([['gbdt', model]]),
      pipeline: null as never,
      testX: proba.map(() => [0]),
      testY: [0, 1, 2, 0, 1, 2, 0, 1],
      testIndices: proba.map((_, i) => i),
      classes: ['a', 'b', 'c'],
      isClassification: true,
      seed: 42,
    };
  }

  it('reads the chosen class against all the others', () => {
    const art = artifacts();
    const first = analyzeThresholds(art, 'gbdt', 0)!;
    expect(first.positiveClass).toBe('a');
    expect(first.oneVsRest).toEqual({ classIndex: 0, classes: ['a', 'b', 'c'] });
    // Labels are binarised: 3 rows are class 'a'.
    expect(first.pairs.filter(([, y]) => y === 1)).toHaveLength(3);

    const second = analyzeThresholds(art, 'gbdt', 1)!;
    expect(second.positiveClass).toBe('b');
    expect(second.pairs.filter(([, y]) => y === 1)).toHaveLength(3);
    // Different class, different probabilities — not the same analysis twice.
    expect(second.pairs).not.toEqual(first.pairs);
  });

  it('clamps an out-of-range class rather than throwing', () => {
    expect(analyzeThresholds(artifacts(), 'gbdt', 99)!.positiveClass).toBe('c');
  });

  it('leaves the binary reading untouched — classes[1] stays the positive one', () => {
    const art = artifacts();
    art.classes = ['no', 'yes'];
    art.testY = [0, 1, 0, 1, 0, 1, 0, 1];
    const analysis = analyzeThresholds(art, 'gbdt', 0)!;
    expect(analysis.positiveClass).toBe('yes');
    expect(analysis.oneVsRest).toBeUndefined();
  });
});

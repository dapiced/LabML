import { describe, expect, it } from 'vitest';
import { profileColumn } from '@/features/ml/data/profile';
import {
  describeSplit,
  featureOrigins,
  replayBoosting,
  replayForest,
  replayNeighbours,
  replayRow,
  replayTree,
  stagedValidation,
  type Replay,
} from '@/features/ml/train/glass-box';
import { KNN_K, trainKnn } from '@/features/ml/train/models';
import { runTraining, type TrainArtifacts } from '@/features/ml/train/trainer';
import type { Cell } from '@/features/ml/data/types';
import type { TrainConfig } from '@/features/ml/train/types';

// V66: a replay is the model. Its last step equals `predict` on every test
// row, for each family and each kind of task; a split is told in the units of
// the file where it translates exactly, and as the model sees it elsewhere.

const N = 240;
const age = Array.from({ length: N }, (_, i) => String(18 + ((i * 37) % 60)));
const income = Array.from({ length: N }, (_, i) => String(20 + ((i * 53) % 90)));
const city = Array.from({ length: N }, (_, i) => ['paris', 'lyon', 'nice'][(i * 7) % 3]);
const binary = age.map((value, i) =>
  Number(value) + (city[i] === 'nice' ? 25 : 0) > 55 ? 'yes' : 'no',
);
const three = income.map((value) =>
  Number(value) < 45 ? 'low' : Number(value) < 80 ? 'mid' : 'high',
);
const amount = age.map((value, i) => String(Number(value) * 3 + Number(income[i]) + (i % 4)));

async function run(target: string, data: Record<string, Cell[]>) {
  const columns = new Map(Object.entries(data));
  const profiles = Object.entries(data).map(([name, values]) => profileColumn(name, values));
  const config: TrainConfig = {
    target,
    features: ['age', 'income', 'city'],
    seed: 7,
    testRatio: 0.2,
  };
  const outcome = await runTraining(columns, profiles, config, {
    onModelStart() {},
    onModelResult() {},
    isCancelled: () => false,
  });
  return { artifacts: outcome!.artifacts, columns };
}

const TASKS: [string, string, Cell[]][] = [
  ['binary', 'label', binary],
  ['multiclass', 'label', three],
  ['regression', 'amount', amount],
];

describe.each(TASKS)('the replay is the model: %s', (_name, target, values) => {
  let artifacts: TrainArtifacts;
  let columns: Map<string, Cell[]>;
  const ready = run(target, { age, income, city, [target]: values }).then((result) => {
    artifacts = result.artifacts;
    columns = result.columns;
  });

  it('walks the tree to the leaf the model answers from, and counts who shares it', async () => {
    await ready;
    const model = artifacts.models.get('tree')!;
    const want = model.predict(artifacts.testX);
    const k = artifacts.classes.length;
    artifacts.testX.forEach((row, i) => {
      const replay = replayTree(
        model,
        row,
        artifacts.pipeline.specs,
        artifacts.isClassification,
        k,
      );
      expect(replay.prediction).toBe(want[i]);
      expect(replay.steps.length).toBeLessThanOrEqual(10);
    });
    // A training row replayed with the fitted rows finds itself in its leaf.
    const train = artifacts.trainIndices!;
    const x = artifacts.pipeline.transform(train);
    const y = train.map((index) =>
      artifacts.isClassification
        ? artifacts.classes.indexOf(String(columns.get(target)![index]))
        : Number(columns.get(target)![index]),
    );
    const replay = replayTree(
      model,
      x[0],
      artifacts.pipeline.specs,
      artifacts.isClassification,
      k,
      {
        x,
        y,
      },
    );
    expect(replay.leaf!.rows).toBeGreaterThanOrEqual(1);
    if (replay.steps.length > 0) expect(replay.steps[0].rows).toBe(train.length);
    for (let d = 1; d < replay.steps.length; d++) {
      expect(replay.steps[d].rows!).toBeLessThanOrEqual(replay.steps[d - 1].rows!);
    }
    if (artifacts.isClassification) {
      expect(replay.leaf!.counts!.reduce((a, v) => a + v, 0)).toBe(replay.leaf!.rows);
    }
  });

  it('counts the trees of the forest to the answer the forest gives', async () => {
    await ready;
    const model = artifacts.models.get('forest')!;
    const want = model.predict(artifacts.testX);
    artifacts.testX.forEach((row, i) => {
      const replay = replayForest(model, row, artifacts.isClassification, artifacts.classes.length);
      if (artifacts.isClassification) {
        expect(replay.prediction).toBe(want[i]);
        expect(replay.votes!.reduce((a, v) => a + v, 0)).toBe(replay.trees);
      } else {
        expect(replay.prediction).toBeCloseTo(want[i], 9);
        expect(replay.spread!.min).toBeLessThanOrEqual(replay.spread!.max);
      }
    });
  });

  it('names the neighbours whose vote is the answer', async () => {
    await ready;
    const model = artifacts.models.get('knn')!;
    const want = model.predict(artifacts.testX);
    artifacts.testX.forEach((row, i) => {
      const replay = replayNeighbours(
        model,
        row,
        KNN_K,
        artifacts.isClassification,
        artifacts.classes.length,
      );
      if (artifacts.isClassification) expect(replay.prediction).toBe(want[i]);
      else expect(replay.prediction).toBeCloseTo(want[i], 9);
      expect(replay.neighbours).toHaveLength(KNN_K);
      for (let n = 1; n < KNN_K; n++) {
        expect(replay.neighbours[n].distance).toBeGreaterThanOrEqual(
          replay.neighbours[n - 1].distance,
        );
      }
    });
  });

  it('adds the rounds up to the answer of the boosting', async () => {
    await ready;
    const model = artifacts.models.get('gbdt')!;
    const want = model.predict(artifacts.testX);
    const proba = model.predictProba?.(artifacts.testX);
    artifacts.testX.forEach((row, i) => {
      const replay = replayBoosting(model, row, artifacts.pipeline.specs);
      expect(replay.prediction).toBe(want[i]);
      expect(replay.curve).toHaveLength(replay.rounds + 1);
      if (proba) {
        expect(replay.curve[replay.rounds]).toBe(proba[i][want[i]]);
        expect(replay.shares).toEqual(proba[i]);
      } else {
        expect(replay.curve[replay.rounds]).toBe(want[i]);
      }
      expect(replay.settledAt).toBeLessThanOrEqual(replay.rounds);
      expect(replay.told.length).toBeLessThanOrEqual(3);
      for (const told of replay.told) expect(told.to).toBe(replay.curve[told.round]);
      // No tree is told twice: the rounds told ask different questions.
      const asked = replay.told.map((told) =>
        told.steps.map((step) => `${step.feature}|${step.threshold}|${step.passed}`).join('>'),
      );
      expect(new Set(asked).size).toBe(asked.length);
      for (const told of replay.told) {
        expect(told.sameQuestions).toBeGreaterThanOrEqual(0);
        expect(told.sameQuestions).toBeLessThan(replay.rounds);
      }
    });
    // Every row shares the starting point.
    const first = replayBoosting(model, artifacts.testX[0], artifacts.pipeline.specs);
    const second = replayBoosting(model, artifacts.testX[1], artifacts.pipeline.specs);
    if (first.prediction === second.prediction) expect(first.curve[0]).toBe(second.curve[0]);
  });

  it('reads the validation error round by round, ending on the error of the model', async () => {
    await ready;
    const model = artifacts.models.get('gbdt')!;
    const staged = stagedValidation(model, artifacts.validationX, artifacts.validationY)!;
    expect(staged.rows).toBe(artifacts.validationX.length);
    expect(staged.metric).toBe(artifacts.isClassification ? 'logLoss' : 'rmse');
    const last = staged.curve.length - 1;
    expect(staged.curve[staged.bestRound]).toBeLessThanOrEqual(staged.curve[last]);
    if (!artifacts.isClassification) {
      const predicted = model.predict(artifacts.validationX);
      const rmse = Math.sqrt(
        predicted.reduce((a, v, i) => a + (v - artifacts.validationY[i]) ** 2, 0) /
          predicted.length,
      );
      expect(staged.curve[last]).toBeCloseTo(rmse, 9);
    }
    expect(stagedValidation(model, [], [])).toBeNull();
  });

  it('answers one row for each family through the worker entry, with rows of the file', async () => {
    await ready;
    const values = { age: '40', income: '60', city: 'nice' };
    const row = artifacts.pipeline.transformRow(values);
    const cache = {};
    for (const key of ['tree', 'forest', 'knn', 'gbdt'] as const) {
      const payload = replayRow(artifacts, key, values, columns, target, cache);
      const replay = payload.replay as Exclude<Replay, { kind: 'none' }>;
      expect(replay.kind).toBe(key);
      const [want] = artifacts.models.get(key)!.predict([row]);
      if (artifacts.isClassification) expect(replay.prediction).toBe(want);
      else expect(replay.prediction).toBeCloseTo(want, 9);
    }
    const tree = replayRow(artifacts, 'tree', values, columns, target, cache).replay;
    expect(tree.kind === 'tree' && tree.leaf !== undefined).toBe(true);

    const knn = replayRow(artifacts, 'knn', values, columns, target, cache).replay;
    if (knn.kind !== 'knn') throw new Error('expected neighbours');
    expect(knn.columns).toEqual(['age', 'income', 'city']);
    knn.rows.forEach((neighbour, i) => {
      // The row number points at the file: its cells are the cells of that row.
      const index = artifacts.trainIndices![knn.neighbours[i].index];
      expect(neighbour.row).toBe(index + 1);
      expect(neighbour.cells).toEqual([age[index], income[index], city[index]]);
      expect(neighbour.target).toBe(String(columns.get(target)![index]));
    });

    for (const key of [
      'linear',
      'logistic',
      'naiveBayes',
      'mlp',
      'ensemble',
      'baseline',
    ] as const) {
      if (!artifacts.models.has(key)) continue;
      expect(replayRow(artifacts, key, values, columns, target, cache).replay.kind).toBe('none');
    }
    expect(() =>
      replayRow({ ...artifacts, models: new Map() }, 'tree', values, columns, target),
    ).toThrow('model-not-found');
  });

  it('names a neighbour by the rows the family was fitted on when it was capped', async () => {
    await ready;
    const values = { age: '40', income: '60', city: 'nice' };
    // A cap keeps a subset: position p of the model is row fitIndices[p] of the file.
    const shifted = artifacts.trainIndices!.map((index) => index + 1000);
    const capped = { ...artifacts, fitIndices: { knn: shifted } };
    const knn = replayRow(capped, 'knn', values, columns, target).replay;
    if (knn.kind !== 'knn') throw new Error('expected neighbours');
    knn.rows.forEach((neighbour, i) => {
      expect(neighbour.row).toBe(shifted[knn.neighbours[i].index] + 1);
    });
  });
});

describe('describeSplit', () => {
  const specs = [
    { kind: 'numeric' as const, name: 'age', median: 30, mean: 40, std: 10 },
    { kind: 'onehot' as const, name: 'sex', categories: ['male', 'female'], mode: 'male' },
    { kind: 'text' as const, name: 'review', terms: ['great', 'slow'], idf: [1, 2] },
    {
      kind: 'ordinal' as const,
      name: 'deck',
      ranks: new Map([['C', 0]]),
      mode: 'C',
      mean: 1,
      std: 2,
    },
  ];
  const origins = featureOrigins(specs);

  it('maps each encoded feature to its source column, in the order of the encoder', () => {
    expect(origins.map((origin) => origin.feature)).toEqual([
      'age',
      'sex=male',
      'sex=female',
      'review:great',
      'review:slow',
      'deck',
    ]);
  });

  it('gives a number back its unit', () => {
    const step = describeSplit(origins[0], -1.5, 0.2, false, true);
    expect(step).toMatchObject({ column: 'age', kind: 'numeric', operator: '<', passed: false });
    expect(step.threshold).toBeCloseTo(25);
    expect(step.value).toBeCloseTo(42);
    expect(describeSplit(origins[0], 0, 0, true, false).operator).toBe('<=');
  });

  it('reads a 0/1 column as a question about the category, whichever way the test is written', () => {
    // The left side of a 0/1 split is "not this category".
    expect(describeSplit(origins[2], 0.5, 1, false, true)).toMatchObject({
      column: 'sex',
      kind: 'category',
      operator: 'is',
      category: 'female',
      passed: true,
    });
    expect(describeSplit(origins[1], 0, 0, true, false).passed).toBe(false);
  });

  it('shows a word and a rank as the model sees them', () => {
    expect(describeSplit(origins[4], 0.12, 0, true, true)).toMatchObject({
      feature: 'review:slow',
      column: 'review',
      kind: 'word',
      threshold: 0.12,
      value: 0,
      passed: true,
    });
    expect(describeSplit(origins[5], 0.3, -0.5, true, false)).toMatchObject({
      kind: 'rank',
      threshold: 0.3,
      value: -0.5,
    });
  });
});

describe('the neighbour search told in full', () => {
  const X = [[0], [1], [1], [3], [4], [5]];
  const y = [0, 0, 1, 1, 1, 1];
  const model = trainKnn(X, y, { task: 'classification', classCount: 2, seed: 1 }, 2);

  it('keeps the row seen first on a tie, as the prediction does, and flags the tie', () => {
    // Rows 1 and 2 are both at distance 1 from 0; row 0 is at distance 0.
    const replay = replayNeighbours(model, [0], 2, true, 2);
    expect(replay.neighbours.map((n) => n.index)).toEqual([0, 1]);
    expect(replay.tieAtTheEdge).toBe(true);
    expect(replay.prediction).toBe(model.predict([[0]])[0]);
  });

  it('flags a tied vote, which the first class wins', () => {
    const replay = replayNeighbours(model, [2], 2, true, 2);
    // Rows 1 and 2 (distance 1, labels 0 and 1), then row 3 at the same distance.
    expect(replay.votes).toEqual([1, 1]);
    expect(replay.tiedVote).toBe(true);
    expect(replay.prediction).toBe(0);
    expect(replay.prediction).toBe(model.predict([[2]])[0]);
  });

  it('reports no tie when there is none', () => {
    const replay = replayNeighbours(model, [5.2], 2, true, 2);
    expect(replay.tieAtTheEdge).toBe(false);
    expect(replay.tiedVote).toBe(false);
    expect(replay.neighbours[0].distance).toBeCloseTo(0.2);
  });
});

/**
 * V37 — speed. Every test here defends the same promise: the run got faster
 * without a single number moving.
 */
import { describe, expect, it } from 'vitest';
import { modelZoo, trainKnn } from '@/features/ml/train/models';
import { rebuildTrainedModel } from '@/features/ml/train/deserialize';
import { helperCount, planBatches, familyCost } from '@/features/ml/train/parallel';
import { mulberry32 } from '@/features/ml/train/random';
import type { ModelContext } from '@/features/ml/train/models';

/**
 * The implementation V37 replaced, kept verbatim as the oracle: every distance
 * in an object, a full stable sort, the first k labels. Slow, obviously right,
 * and the only honest way to claim the fast path changed nothing.
 */
function referenceKnn(X: number[][], y: number[], ctx: ModelContext, kWanted: number) {
  const k = Math.min(kWanted, X.length);
  const neighbors = (row: number[]): number[] => {
    const distances = X.map((trainRow, i) => {
      let sum = 0;
      for (let j = 0; j < row.length; j++) sum += (row[j] - trainRow[j]) ** 2;
      return { i, d: sum };
    });
    distances.sort((a, b) => a.d - b.d);
    return distances.slice(0, k).map(({ i }) => y[i]);
  };
  if (ctx.task === 'regression') {
    return {
      predict: (rows: number[][]) =>
        rows.map((row) => {
          const near = neighbors(row);
          return near.reduce((a, v) => a + v, 0) / near.length;
        }),
      predictProba: undefined,
    };
  }
  const proba = (rows: number[][]) =>
    rows.map((row) => {
      const votes = new Array<number>(ctx.classCount).fill(0);
      for (const label of neighbors(row)) votes[label] += 1;
      return votes.map((v) => v / k);
    });
  return {
    predict: (rows: number[][]) => proba(rows).map((p) => p.indexOf(Math.max(...p))),
    predictProba: proba,
  };
}

function dataset(rows: number[], width: number, classCount: number, seed: number) {
  const rng = mulberry32(seed);
  const X: number[][] = [];
  const y: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    X.push(Array.from({ length: width }, () => Math.round(rng() * 6) / 2));
    y.push(rows[i]);
  }
  return { X, y, classCount };
}

describe('V37 — k-NN: faster, and provably the same model', () => {
  it('predicts exactly what the sorted implementation predicted', () => {
    const labels = Array.from({ length: 300 }, (_, i) => i % 3);
    const { X, y } = dataset(labels, 4, 3, 42);
    const ctx: ModelContext = { task: 'classification', classCount: 3, seed: 42 };
    const queries = X.slice(0, 120).map((row) => row.map((v) => v + 0.25));

    const fast = trainKnn(X, y, ctx, 5);
    const slow = referenceKnn(X, y, ctx, 5);
    expect(fast.predict(queries)).toEqual(slow.predict(queries));
    expect(fast.predictProba!(queries)).toEqual(slow.predictProba!(queries));
  });

  it('breaks ties the way a stable sort did — the earlier row wins', () => {
    // Every training row sits at exactly the same distance from the query, so
    // the answer is decided purely by the tie rule. Rows 0..4 are class 0 and
    // the rest class 1: a first-seen rule votes 0, any other rule may not.
    const X = Array.from({ length: 40 }, () => [1, 1]);
    const y = Array.from({ length: 40 }, (_, i) => (i < 5 ? 0 : 1));
    const ctx: ModelContext = { task: 'classification', classCount: 2, seed: 42 };
    const query = [[0, 0]];
    expect(trainKnn(X, y, ctx, 5).predict(query)).toEqual(
      referenceKnn(X, y, ctx, 5).predict(query),
    );
    expect(trainKnn(X, y, ctx, 5).predict(query)).toEqual([0]);
  });

  it('regresses to the same values', () => {
    const targets = Array.from({ length: 200 }, (_, i) => (i % 17) * 1.5);
    const { X, y } = dataset(targets, 3, 0, 7);
    const ctx: ModelContext = { task: 'regression', classCount: 0, seed: 7 };
    const queries = X.slice(0, 80).map((row) => row.map((v) => v - 0.1));
    expect(trainKnn(X, y, ctx, 5).predict(queries)).toEqual(
      referenceKnn(X, y, ctx, 5).predict(queries),
    );
  });

  it('handles k larger than the training set, as before', () => {
    const X = [
      [0, 0],
      [1, 1],
      [2, 2],
    ];
    const y = [0, 1, 1];
    const ctx: ModelContext = { task: 'classification', classCount: 2, seed: 1 };
    const queries = [
      [0.1, 0.1],
      [5, 5],
    ];
    expect(trainKnn(X, y, ctx, 50).predict(queries)).toEqual(
      referenceKnn(X, y, ctx, 50).predict(queries),
    );
  });

  it('predictWithProba returns exactly predict and predictProba', () => {
    const labels = Array.from({ length: 150 }, (_, i) => i % 4);
    const { X, y } = dataset(labels, 5, 4, 99);
    const ctx: ModelContext = { task: 'classification', classCount: 4, seed: 99 };
    const queries = X.slice(0, 60);
    const model = trainKnn(X, y, ctx, 5);
    const both = model.predictWithProba!(queries);
    expect(both.labels).toEqual(model.predict(queries));
    expect(both.proba).toEqual(model.predictProba!(queries));
  });

  it('offers the single-pass path only where it is really one search', () => {
    // Regression k-NN has no probabilities at all, so there is nothing to fuse.
    const ctx: ModelContext = { task: 'regression', classCount: 0, seed: 3 };
    const model = trainKnn([[0], [1]], [0, 1], ctx, 1);
    expect(model.predictWithProba).toBeUndefined();
    expect(model.predictProba).toBeUndefined();
  });
});

describe('V37 — a family crossing the worker boundary', () => {
  const rng = mulberry32(42);
  const X = Array.from({ length: 600 }, () => [rng(), rng(), rng(), rng()]);
  const y = X.map((row) => (row[0] + row[1] > 1 ? 1 : 0));
  const ctx: ModelContext = { task: 'classification', classCount: 2, seed: 42 };

  /** Every family the helper is allowed to send back, i.e. every one with toJSON. */
  const serialisable = modelZoo('classification')
    .map((def) => ({ key: def.key, model: def.train(X, y, ctx) }))
    .filter((entry) => entry.model.toJSON !== undefined);

  it('covers the whole zoo except k-NN', () => {
    expect(serialisable.map((e) => e.key).sort()).toEqual([
      'baseline',
      'forest',
      'gbdt',
      'logistic',
      'mlp',
      'naiveBayes',
      'tree',
    ]);
  });

  it.each(serialisable.map((e) => [e.key, e] as const))(
    'rebuilds %s from JSON and predicts exactly what the original predicted',
    (_key, entry) => {
      const json = entry.model.toJSON!() as { kind: string };
      // The protocol: a JSON string across postMessage, parsed on the far side.
      const rebuilt = rebuildTrainedModel(json.kind, JSON.parse(JSON.stringify(json)), true);
      expect(rebuilt.predict(X.slice(0, 100))).toEqual(entry.model.predict(X.slice(0, 100)));
    },
  );

  it('stays exportable after the round trip — parallelism takes no feature away', () => {
    // A family fitted in a helper is a normal leaderboard row: the export
    // button must still work on it. The rebuild path itself defines no
    // `toJSON` (an imported model has no reason to be re-exported), so
    // `rebuildTrainedModel` re-attaches the parameters it was handed.
    for (const entry of serialisable) {
      const json = entry.model.toJSON!() as { kind: string };
      const params = JSON.parse(JSON.stringify(json));
      const rebuilt = rebuildTrainedModel(json.kind, params, true);
      expect(rebuilt.toJSON).toBeDefined();
      // Compared as written to the file, not as objects: the originals carry
      // ml-cart's TreeNode prototypes and the round trip carries plain ones,
      // which is exactly the difference an export erases anyway.
      expect(JSON.stringify(rebuilt.toJSON!())).toBe(JSON.stringify(json));
    }
  });

  it('refuses to travel as a structured clone — the bug this protocol avoids', () => {
    // structuredClone keeps shapes JSON drops, and ml-cart's `load()` then
    // builds a tree whose `classify` returns a plain object instead of a
    // matrix: the first prediction throws. This test exists so nobody
    // "simplifies" the protocol back to posting the object directly.
    const tree = serialisable.find((e) => e.key === 'tree')!;
    const json = tree.model.toJSON!() as { kind: string };
    const cloned = rebuildTrainedModel(json.kind, structuredClone(json), true);
    expect(() => cloned.predict(X.slice(0, 1))).toThrow();
  });
});

describe('V37 — planning the helpers', () => {
  it('spawns nothing when a single heavy family would run alone', () => {
    expect(helperCount(['knn', 'tree', 'mlp'], 8)).toBe(0);
  });

  it('never asks for more helpers than the machine has cores to spare', () => {
    expect(helperCount(['mlp', 'logistic', 'forest', 'gbdt'], 2)).toBe(1);
    expect(helperCount(['mlp', 'logistic', 'forest', 'gbdt'], 16)).toBe(4);
  });

  it('balances the batches by measured cost, heaviest first', () => {
    const batches = planBatches(['mlp', 'logistic', 'forest', 'gbdt', 'tree'], 2, familyCost);
    const loads = batches.map((batch) => batch.reduce((total, key) => total + familyCost(key), 0));
    // Greedy LPT on 31/27/25/17/2 splits 58 against 44 — under a fifth apart.
    expect(Math.abs(loads[0] - loads[1]) / Math.max(...loads)).toBeLessThan(0.25);
    expect(batches.flat().sort()).toEqual(['forest', 'gbdt', 'logistic', 'mlp', 'tree']);
  });
});

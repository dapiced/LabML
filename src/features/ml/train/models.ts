import { DecisionTreeClassifier, DecisionTreeRegression } from 'ml-cart';
import { RandomForestClassifier, RandomForestRegression } from 'ml-random-forest';
import { mulberry32, shuffleInPlace } from '@/features/ml/train/random';
import type { ModelKey } from '@/features/ml/train/types';

export interface TrainedModel {
  predict(X: number[][]): number[];
  /** Class probabilities (n × k) — only for models that can produce them. */
  predictProba?(X: number[][]): number[][];
  /** Serializable parameters for export — absent when not exportable (k-NN). */
  toJSON?(): unknown;
}

export interface ModelContext {
  task: 'classification' | 'regression';
  classCount: number;
  seed: number;
}

export interface ModelDef {
  key: ModelKey;
  train(X: number[][], y: number[], ctx: ModelContext): TrainedModel;
}

/** Largest training set k-NN keeps in memory; larger sets are subsampled (seeded). */
const KNN_MAX_TRAIN = 5000;
const KNN_K = 5;

// --- Baseline -------------------------------------------------------------

const baseline: ModelDef = {
  key: 'baseline',
  train(_X, y, ctx) {
    if (ctx.task === 'regression') {
      const mean = y.reduce((a, v) => a + v, 0) / (y.length || 1);
      return {
        predict: (X) => X.map(() => mean),
        toJSON: () => ({ kind: 'baseline', task: 'regression', mean }),
      };
    }
    const counts = new Array<number>(ctx.classCount).fill(0);
    for (const label of y) counts[label] += 1;
    const majority = counts.indexOf(Math.max(...counts));
    const frequencies = counts.map((c) => c / (y.length || 1));
    return {
      predict: (X) => X.map(() => majority),
      predictProba: (X) => X.map(() => [...frequencies]),
      toJSON: () => ({ kind: 'baseline', task: 'classification', majority, frequencies }),
    };
  },
};

// --- Linear regression (ridge, normal equations) --------------------------

/** Solves A·x = b by Gauss–Jordan elimination with partial pivoting. */
function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = A.length;
  const m = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    }
    [m[col], m[pivot]] = [m[pivot], m[col]];
    const value = m[col][col];
    if (Math.abs(value) < 1e-12) continue;
    for (let j = col; j <= n; j++) m[col][j] /= value;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = m[row][col];
      if (factor === 0) continue;
      for (let j = col; j <= n; j++) m[row][j] -= factor * m[col][j];
    }
  }
  return m.map((row) => row[n]);
}

function withBias(row: number[]): number[] {
  return [1, ...row];
}

const linear: ModelDef = {
  key: 'linear',
  train(X, y) {
    const d = (X[0]?.length ?? 0) + 1;
    const xtx: number[][] = Array.from({ length: d }, () => new Array<number>(d).fill(0));
    const xty = new Array<number>(d).fill(0);
    for (let i = 0; i < X.length; i++) {
      const row = withBias(X[i]);
      for (let a = 0; a < d; a++) {
        xty[a] += row[a] * y[i];
        for (let b = a; b < d; b++) xtx[a][b] += row[a] * row[b];
      }
    }
    for (let a = 0; a < d; a++) {
      for (let b = 0; b < a; b++) xtx[a][b] = xtx[b][a];
      xtx[a][a] += 1e-6; // ridge term keeps the system well-posed
    }
    const weights = solveLinearSystem(xtx, xty);
    return {
      predict: (rows) =>
        rows.map((row) => withBias(row).reduce((acc, v, j) => acc + v * weights[j], 0)),
      toJSON: () => ({ kind: 'linear', intercept: weights[0], weights: weights.slice(1) }),
    };
  },
};

// --- Multinomial logistic regression (softmax, batch gradient descent) ----

function softmax(logits: number[]): number[] {
  const max = Math.max(...logits);
  const exps = logits.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, v) => a + v, 0);
  return exps.map((v) => v / sum);
}

const logistic: ModelDef = {
  key: 'logistic',
  train(X, y, ctx) {
    const n = X.length;
    const d = (X[0]?.length ?? 0) + 1;
    const k = ctx.classCount;
    const epochs = n * d > 1_000_000 ? 150 : 300;
    const learningRate = 0.1;
    const l2 = 1e-4;
    const rows = X.map(withBias);
    // Deterministic zero init — reproducible without touching the RNG.
    const weights: number[][] = Array.from({ length: k }, () => new Array<number>(d).fill(0));

    for (let epoch = 0; epoch < epochs; epoch++) {
      const gradient: number[][] = Array.from({ length: k }, () => new Array<number>(d).fill(0));
      for (let i = 0; i < n; i++) {
        const logits = weights.map((w) => w.reduce((acc, v, j) => acc + v * rows[i][j], 0));
        const probs = softmax(logits);
        for (let c = 0; c < k; c++) {
          const delta = probs[c] - (y[i] === c ? 1 : 0);
          const g = gradient[c];
          const row = rows[i];
          for (let j = 0; j < d; j++) g[j] += delta * row[j];
        }
      }
      for (let c = 0; c < k; c++) {
        const w = weights[c];
        const g = gradient[c];
        for (let j = 0; j < d; j++) {
          w[j] -= learningRate * (g[j] / n + l2 * w[j]);
        }
      }
    }

    const proba = (rows2: number[][]) =>
      rows2.map((row) => {
        const withB = withBias(row);
        return softmax(weights.map((w) => w.reduce((acc, v, j) => acc + v * withB[j], 0)));
      });
    return {
      predict: (rows2) => proba(rows2).map((p) => p.indexOf(Math.max(...p))),
      predictProba: proba,
      // Per class: [bias, ...feature weights].
      toJSON: () => ({ kind: 'logistic', weights }),
    };
  },
};

// --- k-nearest neighbors ---------------------------------------------------

const knn: ModelDef = {
  key: 'knn',
  train(X, y, ctx) {
    let trainX = X;
    let trainY = y;
    if (X.length > KNN_MAX_TRAIN) {
      const indices = shuffleInPlace(
        X.map((_, i) => i),
        mulberry32(ctx.seed),
      ).slice(0, KNN_MAX_TRAIN);
      trainX = indices.map((i) => X[i]);
      trainY = indices.map((i) => y[i]);
    }
    const k = Math.min(KNN_K, trainX.length);

    function neighbors(row: number[]): number[] {
      const distances = trainX.map((trainRow, i) => {
        let sum = 0;
        for (let j = 0; j < row.length; j++) sum += (row[j] - trainRow[j]) ** 2;
        return { i, d: sum };
      });
      distances.sort((a, b) => a.d - b.d);
      return distances.slice(0, k).map(({ i }) => trainY[i]);
    }

    if (ctx.task === 'regression') {
      return {
        predict: (rows) =>
          rows.map((row) => {
            const near = neighbors(row);
            return near.reduce((a, v) => a + v, 0) / near.length;
          }),
      };
    }
    const proba = (rows: number[][]) =>
      rows.map((row) => {
        const votes = new Array<number>(ctx.classCount).fill(0);
        for (const label of neighbors(row)) votes[label] += 1;
        return votes.map((v) => v / k);
      });
    return {
      predict: (rows) => proba(rows).map((p) => p.indexOf(Math.max(...p))),
      predictProba: proba,
    };
  },
};

// --- Gaussian naive Bayes --------------------------------------------------

const naiveBayes: ModelDef = {
  key: 'naiveBayes',
  train(X, y, ctx) {
    const k = ctx.classCount;
    const d = X[0]?.length ?? 0;
    const counts = new Array<number>(k).fill(0);
    const sums = Array.from({ length: k }, () => new Array<number>(d).fill(0));
    const squares = Array.from({ length: k }, () => new Array<number>(d).fill(0));
    for (let i = 0; i < X.length; i++) {
      const c = y[i];
      counts[c] += 1;
      for (let j = 0; j < d; j++) {
        sums[c][j] += X[i][j];
        squares[c][j] += X[i][j] ** 2;
      }
    }
    const priors = counts.map((c) => Math.log((c + 1) / (X.length + k)));
    const means = sums.map((row, c) => row.map((v) => (counts[c] ? v / counts[c] : 0)));
    const variances = squares.map((row, c) =>
      row.map((v, j) => Math.max((counts[c] ? v / counts[c] : 0) - means[c][j] ** 2, 1e-9)),
    );

    const logJoint = (row: number[]) =>
      priors.map((prior, c) => {
        let sum = prior;
        for (let j = 0; j < d; j++) {
          const variance = variances[c][j];
          sum +=
            -0.5 * Math.log(2 * Math.PI * variance) - (row[j] - means[c][j]) ** 2 / (2 * variance);
        }
        return sum;
      });
    const proba = (rows: number[][]) => rows.map((row) => softmax(logJoint(row)));
    return {
      predict: (rows) => proba(rows).map((p) => p.indexOf(Math.max(...p))),
      predictProba: proba,
      toJSON: () => ({ kind: 'naiveBayes', logPriors: priors, means, variances }),
    };
  },
};

// --- Trees (ml.js) ---------------------------------------------------------

const tree: ModelDef = {
  key: 'tree',
  train(X, y, ctx) {
    if (ctx.task === 'regression') {
      const model = new DecisionTreeRegression({
        gainFunction: 'regression',
        maxDepth: 10,
        minNumSamples: 3,
      });
      model.train(X, y);
      return {
        predict: (rows) => model.predict(rows),
        toJSON: () => ({ kind: 'tree', model: model.toJSON() }),
      };
    }
    const model = new DecisionTreeClassifier({
      gainFunction: 'gini',
      maxDepth: 10,
      minNumSamples: 3,
    });
    model.train(X, y);
    return {
      predict: (rows) => model.predict(rows),
      toJSON: () => ({ kind: 'tree', model: model.toJSON() }),
    };
  },
};

const forest: ModelDef = {
  key: 'forest',
  train(X, y, ctx) {
    const options = { nEstimators: 40, seed: ctx.seed, useSampleBagging: true };
    if (ctx.task === 'regression') {
      const model = new RandomForestRegression(options);
      model.train(X, y);
      return {
        predict: (rows) => model.predict(rows),
        toJSON: () => ({ kind: 'forest', model: model.toJSON() }),
      };
    }
    const model = new RandomForestClassifier(options);
    model.train(X, y);
    return {
      predict: (rows) => model.predict(rows),
      toJSON: () => ({ kind: 'forest', model: model.toJSON() }),
    };
  },
};

export function modelZoo(task: 'classification' | 'regression'): ModelDef[] {
  return task === 'classification'
    ? [baseline, logistic, knn, naiveBayes, tree, forest]
    : [baseline, linear, knn, tree, forest];
}

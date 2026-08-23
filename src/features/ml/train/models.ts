import { DecisionTreeClassifier, DecisionTreeRegression } from 'ml-cart';
import { RandomForestClassifier, RandomForestRegression } from 'ml-random-forest';
import { trainGbdtClassifier, trainGbdtRegressor } from '@/features/ml/train/gbdt';
import { trainMlp } from '@/features/ml/train/mlp';
import type { ModelKey } from '@/features/ml/train/types';
import { balancedResample } from '@/features/ml/train/class-weight';

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
  /**
   * V36: per-class weights, present only when the user turned class weighting
   * on (classification, imbalanced target). Families weight their own loss
   * where they can (logistic, gbdt) and fall back to seeded balanced
   * resampling where the implementation takes no weights (tree, forest).
   * See class-weight.ts — the mechanism is named per family in the UI.
   */
  classWeights?: number[];
}

export interface ModelDef {
  key: ModelKey;
  train(X: number[][], y: number[], ctx: ModelContext): TrainedModel;
}

const KNN_K = 5;

/**
 * V36: the ml-cart families cannot take sample weights, so class weighting
 * becomes a seeded balanced resample of the training rows. Returns the rows
 * unchanged when weighting is off or the task is regression.
 */
function weightedFit(
  X: number[][],
  y: number[],
  ctx: ModelContext,
): { X: number[][]; y: number[] } {
  if (ctx.classWeights === undefined || ctx.task !== 'classification') return { X, y };
  const order = balancedResample(y, ctx.classCount, ctx.seed);
  return { X: order.map((i) => X[i]), y: order.map((i) => y[i]) };
}

/**
 * V25: measured per-family training caps (rows). Slow families train on an
 * ANNOUNCED seeded sample of the train split — never silently: the trainer
 * records the exact row count on every result and the leaderboard shows it.
 * Numbers come from the V25 benchmarks (worst measured cases, PLAN.md § N):
 * every demo dataset sits below every cap, so nothing existing changes.
 */
export const MODEL_TRAIN_CAPS: Partial<Record<ModelKey, number>> = {
  knn: 5_000, // O(n²) distances at prediction time — was a SILENT internal cap before V25
  forest: 1_000, // 40 unbounded trees: ~25 s at 1 000 rows in the worst measured case
  tree: 2_000, // one unbounded tree: ~2.3 s at 2 000 rows
  logistic: 20_000, // batch gradient descent: ~9 s at 20 000 rows
  linear: 20_000, // normal equations are O(n·d²) — wide text blocks make n matter
  mlp: 20_000, // ~11 s at 20 000 rows
  gbdt: 50_000, // histogram boosting scales best: ~10 s at 50 000 rows
};

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

    // V36: each row's gradient contribution is scaled by its class weight,
    // and the step is normalised by the TOTAL weight rather than by n — so
    // turning weighting on changes the balance, not the learning rate.
    const rowWeight = ctx.classWeights ?? null;
    const totalWeight =
      rowWeight === null ? n : y.reduce((a, label) => a + (rowWeight[label] ?? 1), 0);

    for (let epoch = 0; epoch < epochs; epoch++) {
      const gradient: number[][] = Array.from({ length: k }, () => new Array<number>(d).fill(0));
      for (let i = 0; i < n; i++) {
        const logits = weights.map((w) => w.reduce((acc, v, j) => acc + v * rows[i][j], 0));
        const probs = softmax(logits);
        const wi = rowWeight === null ? 1 : (rowWeight[y[i]] ?? 1);
        for (let c = 0; c < k; c++) {
          const delta = (probs[c] - (y[i] === c ? 1 : 0)) * wi;
          const g = gradient[c];
          const row = rows[i];
          for (let j = 0; j < d; j++) g[j] += delta * row[j];
        }
      }
      for (let c = 0; c < k; c++) {
        const w = weights[c];
        const g = gradient[c];
        for (let j = 0; j < d; j++) {
          w[j] -= learningRate * (g[j] / (totalWeight || 1) + l2 * w[j]);
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

/** Parameterizable k-NN — the zoo uses k = 5, the hyperparameter search varies it. */
export function trainKnn(
  X: number[][],
  y: number[],
  ctx: ModelContext,
  kWanted: number,
): TrainedModel {
  // V25: no silent subsample here any more — callers (trainer, search) cap the
  // training set through the announced mechanism before this function runs.
  const trainX = X;
  const trainY = y;
  const k = Math.min(kWanted, trainX.length);

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
}

const knn: ModelDef = {
  key: 'knn',
  train: (X, y, ctx) => trainKnn(X, y, ctx, KNN_K),
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
    // V36: ml-cart takes no sample weights, so balancing happens by seeded
    // repetition of the rarer classes — named 'resample' in the UI.
    const fit = weightedFit(X, y, ctx);
    model.train(fit.X, fit.y);
    return {
      predict: (rows) => model.predict(rows),
      toJSON: () => ({ kind: 'tree', model: model.toJSON() }),
    };
  },
};

/** Parameterizable random forest — the zoo uses 40 unbounded trees. */
export function trainForest(
  X: number[][],
  y: number[],
  ctx: ModelContext,
  params?: { nEstimators: number; maxDepth?: number },
): TrainedModel {
  const options = {
    nEstimators: params?.nEstimators ?? 40,
    seed: ctx.seed,
    useSampleBagging: true,
    ...(params?.maxDepth !== undefined && { treeOptions: { maxDepth: params.maxDepth } }),
  };
  if (ctx.task === 'regression') {
    const model = new RandomForestRegression(options);
    model.train(X, y);
    return {
      predict: (rows) => model.predict(rows),
      toJSON: () => ({ kind: 'forest', model: model.toJSON() }),
    };
  }
  const model = new RandomForestClassifier(options);
  const fit = weightedFit(X, y, ctx);
  model.train(fit.X, fit.y);
  return {
    predict: (rows) => model.predict(rows),
    toJSON: () => ({ kind: 'forest', model: model.toJSON() }),
  };
}

const forest: ModelDef = {
  key: 'forest',
  train: (X, y, ctx) => trainForest(X, y, ctx),
};

// --- Histogram gradient boosting (own implementation, see gbdt.ts) ---------

const gbdt: ModelDef = {
  key: 'gbdt',
  train(X, y, ctx) {
    if (ctx.task === 'regression') {
      const model = trainGbdtRegressor(X, y);
      return {
        predict: (rows) => model.predictRaw(rows),
        // Bin edges and learning rate ride along — trees split on BIN indices,
        // so without them the export cannot predict (v22 import needs both).
        toJSON: () => ({
          kind: 'gbdt',
          task: 'regression',
          learningRate: model.params.learningRate,
          baseScore: model.baseScore,
          trees: model.trees,
          edges: model.binning.edges,
        }),
      };
    }
    const model = trainGbdtClassifier(X, y, ctx.classCount, undefined, ctx.classWeights);
    return {
      predict: (rows) => model.proba(rows).map((p) => p.indexOf(Math.max(...p))),
      predictProba: (rows) => model.proba(rows),
      toJSON: () => ({
        kind: 'gbdt',
        task: 'classification',
        learningRate: model.boosters[0].params.learningRate,
        boosters: model.boosters.map((b) => ({
          baseScore: b.baseScore,
          trees: b.trees,
          edges: b.binning.edges,
        })),
      }),
    };
  },
};

// --- Neural network (own MLP, see mlp.ts) ----------------------------------

const mlp: ModelDef = {
  key: 'mlp',
  train(X, y, ctx) {
    if (ctx.task === 'regression') {
      const model = trainMlp(X, y, 0, ctx.seed);
      return {
        predict: (rows) => model.forward(rows).map((p) => p[0]),
        toJSON: () => model.toJSON(),
      };
    }
    const model = trainMlp(X, y, ctx.classCount, ctx.seed);
    return {
      predict: (rows) => model.forward(rows).map((p) => p.indexOf(Math.max(...p))),
      predictProba: (rows) => model.forward(rows),
      toJSON: () => model.toJSON(),
    };
  },
};

export function modelZoo(task: 'classification' | 'regression'): ModelDef[] {
  return task === 'classification'
    ? [baseline, logistic, knn, naiveBayes, tree, forest, gbdt, mlp]
    : [baseline, linear, knn, tree, forest, gbdt, mlp];
}

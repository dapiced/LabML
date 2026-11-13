/**
 * Histogram-based gradient-boosted decision trees, in the spirit of
 * LightGBM/XGBoost: features are bucketed into quantile bins once, trees are
 * grown depth-wise on second-order gradients (XGBoost-style gain), and leaves
 * take Newton values. Deterministic by construction — no randomness at all.
 *
 * V67: why the rounds are run to the end. V66 showed the validation error of
 * the boosting lowest well before round 120 on 17 runs of 30, which reads as a
 * case for early stopping. Measured before building it: six demos, ten splits
 * each, a quarter of the rows kept away from everything, the 120 rounds
 * against a stop at the lowest validation error (and against a stop chosen on
 * rows held out inside the training rows, with or without a refit on all of
 * them). On the metric the leaderboard ranks on:
 *
 *   titanic  +0.4 accuracy point (better 5, worse 4)      log loss better 10/10
 *   fraud    no change                                    log loss slightly worse
 *   iris     no change                                    log loss slightly worse
 *   reviews  -4.0 accuracy points (worse 6, better 2)     log loss better 10/10
 *   mpg      no change in RMSE
 *   energy   RMSE 3.5 % lower (better 9, worse 1)
 *
 * Fewer rounds give better probabilities and no better predictions; the one
 * gain is on energy, where the boosting does no better than the mean and is
 * never the family the validation rows choose. Stops chosen on inner held-out
 * rows did no better than the validation stop on five demos of six. And a stop chosen on
 * the validation rows flatters the boosting on the rows that choose the
 * family: its validation score rose above its private score by 0.9 accuracy
 * point on titanic and 6 on reviews. So nothing stops early here.
 */

export interface GbdtParams {
  nRounds: number;
  learningRate: number;
  maxDepth: number;
  minChildSamples: number;
  lambda: number;
  maxBins: number;
}

export const GBDT_DEFAULTS: GbdtParams = {
  nRounds: 120,
  learningRate: 0.1,
  maxDepth: 4,
  minChildSamples: 10,
  lambda: 1,
  maxBins: 32,
};

export interface GbdtNode {
  /** Feature index of the split; -1 for leaves. */
  feature: number;
  /** Rows whose bin ≤ threshold go left. */
  threshold: number;
  left: number;
  right: number;
  value: number;
}

export interface GbdtTree {
  nodes: GbdtNode[];
}

interface Binning {
  /** Per feature: ascending bin upper-edge values (raw feature space). */
  edges: number[][];
}

function computeBinning(X: number[][], maxBins: number): Binning {
  const d = X[0]?.length ?? 0;
  const edges: number[][] = [];
  for (let j = 0; j < d; j++) {
    const values = [...new Set(X.map((row) => row[j]))].sort((a, b) => a - b);
    if (values.length <= maxBins) {
      edges.push(values);
      continue;
    }
    const quantiles: number[] = [];
    for (let b = 1; b <= maxBins; b++) {
      quantiles.push(
        values[Math.min(values.length - 1, Math.floor((b * values.length) / maxBins) - 1)],
      );
    }
    edges.push([...new Set(quantiles)].sort((a, b) => a - b));
  }
  return { edges };
}

/** The bin a raw value falls in: the first edge at or above it. Exported for the replay (V66). */
export function binValue(edges: number[], value: number): number {
  // Binary search: first edge ≥ value.
  let lo = 0;
  let hi = edges.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (edges[mid] >= value) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

function binMatrix(X: number[][], binning: Binning): Uint8Array[] {
  return X.map((row) => {
    const binned = new Uint8Array(row.length);
    for (let j = 0; j < row.length; j++) binned[j] = binValue(binning.edges[j], row[j]);
    return binned;
  });
}

/** Grows one depth-wise tree on (g, h) and returns it; updates predictions in place. */
function growTree(
  binned: Uint8Array[],
  binning: Binning,
  g: Float64Array,
  h: Float64Array,
  params: GbdtParams,
): GbdtTree {
  const nodes: GbdtNode[] = [];
  const d = binning.edges.length;

  function leafValue(rows: number[]): number {
    let G = 0;
    let H = 0;
    for (const i of rows) {
      G += g[i];
      H += h[i];
    }
    return -G / (H + params.lambda);
  }

  function build(rows: number[], depth: number): number {
    const index = nodes.length;
    nodes.push({ feature: -1, threshold: 0, left: -1, right: -1, value: 0 });

    let G = 0;
    let H = 0;
    for (const i of rows) {
      G += g[i];
      H += h[i];
    }
    const baseScore = (G * G) / (H + params.lambda);

    // Like LightGBM's min_gain_to_split = 0: zero-gain splits are allowed, so
    // depth can expose pure interactions (XOR) whose first split gains nothing.
    let best = { gain: -1e-9, feature: -1, threshold: 0 };
    if (depth < params.maxDepth && rows.length >= 2 * params.minChildSamples) {
      for (let j = 0; j < d; j++) {
        const bins = binning.edges[j].length;
        if (bins < 2) continue;
        const gHist = new Float64Array(bins);
        const hHist = new Float64Array(bins);
        const countHist = new Int32Array(bins);
        for (const i of rows) {
          const b = binned[i][j];
          gHist[b] += g[i];
          hHist[b] += h[i];
          countHist[b] += 1;
        }
        let GL = 0;
        let HL = 0;
        let countL = 0;
        for (let b = 0; b < bins - 1; b++) {
          GL += gHist[b];
          HL += hHist[b];
          countL += countHist[b];
          const countR = rows.length - countL;
          if (countL < params.minChildSamples || countR < params.minChildSamples) continue;
          const GR = G - GL;
          const HR = H - HL;
          const gain =
            0.5 * ((GL * GL) / (HL + params.lambda) + (GR * GR) / (HR + params.lambda) - baseScore);
          if (gain > best.gain + 1e-12) best = { gain, feature: j, threshold: b };
        }
      }
    }

    if (best.feature === -1) {
      nodes[index].value = leafValue(rows);
      return index;
    }

    const leftRows: number[] = [];
    const rightRows: number[] = [];
    for (const i of rows) {
      if (binned[i][best.feature] <= best.threshold) leftRows.push(i);
      else rightRows.push(i);
    }
    nodes[index].feature = best.feature;
    nodes[index].threshold = best.threshold;
    nodes[index].left = build(leftRows, depth + 1);
    nodes[index].right = build(rightRows, depth + 1);
    return index;
  }

  build(
    Array.from({ length: g.length }, (_, i) => i),
    0,
  );
  return { nodes };
}

function treePredictBinned(tree: GbdtTree, binnedRow: Uint8Array): number {
  let node = tree.nodes[0];
  while (node.feature !== -1) {
    node =
      binnedRow[node.feature] <= node.threshold ? tree.nodes[node.left] : tree.nodes[node.right];
  }
  return node.value;
}

export interface GbdtModel {
  predictRaw(X: number[][]): number[];
  trees: GbdtTree[];
  baseScore: number;
  binning: Binning;
  params: GbdtParams;
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

/**
 * Boosts on an arbitrary objective supplied as a gradient callback.
 * `objective(pred, g, h)` must fill g and h for the current raw predictions.
 */
function boost(
  X: number[][],
  params: GbdtParams,
  baseScore: number,
  objective: (pred: Float64Array, g: Float64Array, h: Float64Array) => void,
): GbdtModel {
  const n = X.length;
  const binning = computeBinning(X, params.maxBins);
  const binned = binMatrix(X, binning);
  const pred = new Float64Array(n).fill(baseScore);
  const g = new Float64Array(n);
  const h = new Float64Array(n);
  const trees: GbdtTree[] = [];

  for (let round = 0; round < params.nRounds; round++) {
    objective(pred, g, h);
    const tree = growTree(binned, binning, g, h, params);
    // A root leaf with ~zero value means no structure is left to learn.
    if (tree.nodes.length === 1 && Math.abs(tree.nodes[0].value) < 1e-10) break;
    trees.push(tree);
    for (let i = 0; i < n; i++) pred[i] += params.learningRate * treePredictBinned(tree, binned[i]);
  }

  return {
    trees,
    baseScore,
    binning,
    params,
    predictRaw(rows: number[][]): number[] {
      return rows.map((row) => {
        const binnedRow = new Uint8Array(row.length);
        for (let j = 0; j < row.length; j++) binnedRow[j] = binValue(binning.edges[j], row[j]);
        let score = baseScore;
        for (const tree of trees) score += params.learningRate * treePredictBinned(tree, binnedRow);
        return score;
      });
    },
  };
}

/** Squared-loss regression: g = pred − y, h = 1. */
export function trainGbdtRegressor(
  X: number[][],
  y: number[],
  params: GbdtParams = GBDT_DEFAULTS,
): GbdtModel {
  const mean = y.reduce((a, v) => a + v, 0) / (y.length || 1);
  return boost(X, params, mean, (pred, g, h) => {
    for (let i = 0; i < y.length; i++) {
      g[i] = pred[i] - y[i];
      h[i] = 1;
    }
  });
}

/**
 * Log-loss binary booster: g = p − y, h = p(1 − p). Returns raw log-odds.
 *
 * V36: `weights` scales each row's gradient AND hessian, which is the correct
 * weighting for a second-order booster — scaling only the gradient would
 * inflate the leaf values instead of rebalancing the classes.
 */
export function trainGbdtBinary(
  X: number[][],
  y01: number[],
  params: GbdtParams = GBDT_DEFAULTS,
  weights?: number[],
): GbdtModel {
  // The base score is the weighted prior, so a weighted run starts from the
  // balance it is aiming at rather than from the raw class ratio.
  let positiveMass = 0;
  let totalMass = 0;
  for (let i = 0; i < y01.length; i++) {
    const w = weights?.[i] ?? 1;
    positiveMass += w * y01[i];
    totalMass += w;
  }
  const prior = Math.min(1 - 1e-6, Math.max(1e-6, positiveMass / (totalMass || 1)));
  const base = Math.log(prior / (1 - prior));
  return boost(X, params, base, (pred, g, h) => {
    for (let i = 0; i < y01.length; i++) {
      const p = sigmoid(pred[i]);
      const w = weights?.[i] ?? 1;
      g[i] = w * (p - y01[i]);
      h[i] = w * Math.max(p * (1 - p), 1e-12);
    }
  });
}

/** Multiclass via one-vs-rest binary boosters, probabilities normalized. */
export function trainGbdtClassifier(
  X: number[][],
  y: number[],
  classCount: number,
  params?: GbdtParams,
  /** V36: per-CLASS weights; expanded to per-row inside each booster. */
  classWeights?: number[],
) {
  const rowWeights =
    classWeights === undefined ? undefined : y.map((label) => classWeights[label] ?? 1);
  const boosters =
    classCount === 2
      ? [trainGbdtBinary(X, y, params, rowWeights)]
      : Array.from({ length: classCount }, (_, c) =>
          trainGbdtBinary(
            X,
            y.map((label) => (label === c ? 1 : 0)),
            params,
            rowWeights,
          ),
        );

  function proba(rows: number[][]): number[][] {
    if (classCount === 2) {
      const p1 = boosters[0].predictRaw(rows).map(sigmoid);
      return p1.map((p) => [1 - p, p]);
    }
    const raw = boosters.map((b) => b.predictRaw(rows).map(sigmoid));
    return rows.map((_, i) => {
      const scores = raw.map((column) => column[i]);
      const sum = scores.reduce((a, v) => a + v, 0) || 1;
      return scores.map((v) => v / sum);
    });
  }

  return { boosters, proba };
}

/**
 * Raw-score predictor rebuilt from exported parameters alone (v22 import):
 * the same bin edges and learning rate the booster trained with.
 */
export function gbdtRawPredictor(
  trees: GbdtTree[],
  baseScore: number,
  edges: number[][],
  learningRate: number,
): (rows: number[][]) => number[] {
  return (rows) =>
    rows.map((row) => {
      const binnedRow = new Uint8Array(row.length);
      for (let j = 0; j < row.length; j++) binnedRow[j] = binValue(edges[j], row[j]);
      let score = baseScore;
      for (const tree of trees) score += learningRate * treePredictBinned(tree, binnedRow);
      return score;
    });
}

/** The sigmoid, exported for the import path's probability rebuild. */
export function gbdtSigmoid(z: number): number {
  return sigmoid(z);
}

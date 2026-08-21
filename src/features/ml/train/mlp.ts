/**
 * A small multilayer perceptron, hand-written and fully deterministic:
 * one ReLU hidden layer, He initialization from a seeded PRNG, full-batch
 * Adam. Softmax + cross-entropy for classification, linear + MSE for
 * regression (with the target standardized internally for stable training).
 */
import { mulberry32 } from '@/features/ml/train/random';

export interface MlpParams {
  hidden: number;
  epochs: number;
  learningRate: number;
  l2: number;
}

function heInit(rows: number, cols: number, rng: () => number): Float64Array {
  const weights = new Float64Array(rows * cols);
  const scale = Math.sqrt(2 / rows);
  for (let i = 0; i < weights.length; i += 2) {
    // Box–Muller from the seeded uniform PRNG.
    const u1 = Math.max(rng(), 1e-12);
    const u2 = rng();
    const radius = Math.sqrt(-2 * Math.log(u1));
    weights[i] = radius * Math.cos(2 * Math.PI * u2) * scale;
    if (i + 1 < weights.length) weights[i + 1] = radius * Math.sin(2 * Math.PI * u2) * scale;
  }
  return weights;
}

class Adam {
  private m: Float64Array;
  private v: Float64Array;
  private t = 0;
  constructor(
    private readonly size: number,
    private readonly lr: number,
  ) {
    this.m = new Float64Array(size);
    this.v = new Float64Array(size);
  }
  step(weights: Float64Array, grad: Float64Array) {
    this.t += 1;
    const b1 = 0.9;
    const b2 = 0.999;
    const correction1 = 1 - b1 ** this.t;
    const correction2 = 1 - b2 ** this.t;
    for (let i = 0; i < this.size; i++) {
      this.m[i] = b1 * this.m[i] + (1 - b1) * grad[i];
      this.v[i] = b2 * this.v[i] + (1 - b2) * grad[i] * grad[i];
      weights[i] -=
        (this.lr * (this.m[i] / correction1)) / (Math.sqrt(this.v[i] / correction2) + 1e-8);
    }
  }
}

export interface MlpModel {
  /** Raw outputs: probabilities (n × k) for classification, values (n × 1) for regression. */
  forward(X: number[][]): number[][];
  toJSON(): unknown;
}

export function defaultMlpParams(n: number, d: number): MlpParams {
  return {
    hidden: Math.max(16, Math.min(64, 2 * d)),
    epochs: n * d > 500_000 ? 150 : 300,
    learningRate: 0.01,
    l2: 1e-4,
  };
}

/**
 * Trains the network. For classification pass `classCount ≥ 2` and integer
 * labels; for regression pass `classCount = 0` and raw target values.
 */
export function trainMlp(
  X: number[][],
  y: number[],
  classCount: number,
  seed: number,
  params?: MlpParams,
): MlpModel {
  const n = X.length;
  const d = X[0]?.length ?? 0;
  const p = params ?? defaultMlpParams(n, d);
  const isClassification = classCount >= 2;
  const outputs = isClassification ? classCount : 1;
  const rng = mulberry32(seed);

  // Standardize the regression target internally.
  let yMean = 0;
  let yStd = 1;
  let targets = y;
  if (!isClassification) {
    yMean = y.reduce((a, v) => a + v, 0) / (n || 1);
    yStd = Math.sqrt(y.reduce((a, v) => a + (v - yMean) ** 2, 0) / (n || 1)) || 1;
    targets = y.map((v) => (v - yMean) / yStd);
  }

  const W1 = heInit(d, p.hidden, rng);
  const b1 = new Float64Array(p.hidden);
  const W2 = heInit(p.hidden, outputs, rng);
  const b2 = new Float64Array(outputs);
  const optW1 = new Adam(W1.length, p.learningRate);
  const optB1 = new Adam(b1.length, p.learningRate);
  const optW2 = new Adam(W2.length, p.learningRate);
  const optB2 = new Adam(b2.length, p.learningRate);

  const hiddenAct = new Float64Array(n * p.hidden);
  const out = new Float64Array(n * outputs);

  function forwardBatch(rows: number[][], hiddenBuffer: Float64Array, outBuffer: Float64Array) {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      for (let hUnit = 0; hUnit < p.hidden; hUnit++) {
        let sum = b1[hUnit];
        for (let j = 0; j < d; j++) sum += row[j] * W1[j * p.hidden + hUnit];
        hiddenBuffer[i * p.hidden + hUnit] = sum > 0 ? sum : 0;
      }
      for (let o = 0; o < outputs; o++) {
        let sum = b2[o];
        for (let hUnit = 0; hUnit < p.hidden; hUnit++) {
          sum += hiddenBuffer[i * p.hidden + hUnit] * W2[hUnit * outputs + o];
        }
        outBuffer[i * outputs + o] = sum;
      }
      if (isClassification) {
        let max = -Infinity;
        for (let o = 0; o < outputs; o++) max = Math.max(max, outBuffer[i * outputs + o]);
        let sum = 0;
        for (let o = 0; o < outputs; o++) {
          const e = Math.exp(outBuffer[i * outputs + o] - max);
          outBuffer[i * outputs + o] = e;
          sum += e;
        }
        for (let o = 0; o < outputs; o++) outBuffer[i * outputs + o] /= sum;
      }
    }
  }

  const gradW1 = new Float64Array(W1.length);
  const gradB1 = new Float64Array(b1.length);
  const gradW2 = new Float64Array(W2.length);
  const gradB2 = new Float64Array(b2.length);
  const deltaOut = new Float64Array(outputs);
  const deltaHidden = new Float64Array(p.hidden);

  for (let epoch = 0; epoch < p.epochs; epoch++) {
    forwardBatch(X, hiddenAct, out);
    gradW1.fill(0);
    gradB1.fill(0);
    gradW2.fill(0);
    gradB2.fill(0);

    for (let i = 0; i < n; i++) {
      for (let o = 0; o < outputs; o++) {
        const predicted = out[i * outputs + o];
        deltaOut[o] = isClassification
          ? (predicted - (y[i] === o ? 1 : 0)) / n
          : ((predicted - targets[i]) * 2) / n;
      }
      for (let hUnit = 0; hUnit < p.hidden; hUnit++) {
        const activation = hiddenAct[i * p.hidden + hUnit];
        let sum = 0;
        for (let o = 0; o < outputs; o++) {
          sum += deltaOut[o] * W2[hUnit * outputs + o];
          gradW2[hUnit * outputs + o] += activation * deltaOut[o];
        }
        deltaHidden[hUnit] = activation > 0 ? sum : 0;
      }
      for (let o = 0; o < outputs; o++) gradB2[o] += deltaOut[o];
      const row = X[i];
      for (let j = 0; j < d; j++) {
        const x = row[j];
        if (x === 0) continue;
        for (let hUnit = 0; hUnit < p.hidden; hUnit++) {
          gradW1[j * p.hidden + hUnit] += x * deltaHidden[hUnit];
        }
      }
      for (let hUnit = 0; hUnit < p.hidden; hUnit++) gradB1[hUnit] += deltaHidden[hUnit];
    }

    for (let i = 0; i < W1.length; i++) gradW1[i] += p.l2 * W1[i];
    for (let i = 0; i < W2.length; i++) gradW2[i] += p.l2 * W2[i];
    optW1.step(W1, gradW1);
    optB1.step(b1, gradB1);
    optW2.step(W2, gradW2);
    optB2.step(b2, gradB2);
  }

  return {
    forward(rows: number[][]): number[][] {
      const hiddenBuffer = new Float64Array(rows.length * p.hidden);
      const outBuffer = new Float64Array(rows.length * outputs);
      forwardBatch(rows, hiddenBuffer, outBuffer);
      return rows.map((_, i) => {
        const values: number[] = [];
        for (let o = 0; o < outputs; o++) {
          const raw = outBuffer[i * outputs + o];
          values.push(isClassification ? raw : raw * yStd + yMean);
        }
        return values;
      });
    },
    toJSON: () => ({
      kind: 'mlp',
      hidden: p.hidden,
      W1: [...W1],
      b1: [...b1],
      W2: [...W2],
      b2: [...b2],
      yMean,
      yStd,
    }),
  };
}

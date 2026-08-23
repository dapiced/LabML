/**
 * v22 — the exported model comes back. Rebuilds a working predictor and its
 * fitted pipeline from a format-v2 export, with NAMED refusals: a file that
 * cannot be trusted to predict exactly is rejected, never half-loaded.
 * (k-NN never exports — its "parameters" are the training set itself.)
 */
import { DecisionTreeClassifier, DecisionTreeRegression } from 'ml-cart';
import { RandomForestClassifier, RandomForestRegression } from 'ml-random-forest';

/** ml.js classes all expose a static load(); their typings omit it. */
interface Loadable {
  load(json: unknown): { predict(rows: number[][]): number[] };
}
const loadable = (cls: unknown) => cls as Loadable;
import { gbdtRawPredictor, gbdtSigmoid, type GbdtTree } from '@/features/ml/train/gbdt';
import {
  buildRowEncoder,
  specsFromJson,
  type PipelineSpecJson,
} from '@/features/ml/train/pipeline';
import type { TrainedModel } from '@/features/ml/train/models';
import type { Cell } from '@/features/ml/data/types';
import type { MetricMap, ModelKey } from '@/features/ml/train/types';

export interface ImportedManifest {
  model: ModelKey;
  isClassification: boolean;
  target: string;
  classes: string[];
  seed: number;
  createdAt: number | null;
  sourceDataset: { name: string; rowCount: number } | null;
  /** Held-out test metrics of the exporting run — the honest reference. */
  testMetrics: MetricMap;
  testRows: number | null;
  /** Source columns the pipeline needs on any file to score. */
  featureColumns: string[];
}

export interface ImportedModel {
  manifest: ImportedManifest;
  model: TrainedModel;
  specs: ReturnType<typeof specsFromJson>;
  transformRow(record: Record<string, Cell>): number[];
}

function softmax(logits: number[]): number[] {
  const max = Math.max(...logits);
  const exps = logits.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, v) => a + v, 0);
  return exps.map((v) => v / sum);
}

function argmaxRows(proba: (rows: number[][]) => number[][]) {
  return (rows: number[][]) => proba(rows).map((p) => p.indexOf(Math.max(...p)));
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * V37: exported for the parallel trainer. A model cannot cross a worker
 * boundary — `predict` is a closure, and structured clone drops functions —
 * so a helper worker returns `toJSON()` as a JSON string and the main worker
 * parses it and rebuilds the predictor here. Passing the object instead of the
 * string does NOT work: structured clone keeps shapes JSON drops, and ml-cart's
 * `load()` then rebuilds a tree that throws on its first prediction. Going
 * through JSON is what makes a parallel run and an imported model the same
 * object rather than merely similar ones.
 */
export function rebuildTrainedModel(
  kind: string,
  params: any,
  isClassification: boolean,
): TrainedModel {
  // The rebuild path produces a predictor, not an exporter: nothing in
  // `rebuildModel` defines `toJSON`, because an imported model has no reason
  // to be re-exported. A family trained in a helper does — it is a normal row
  // of a normal run, and the export button must still work on it. The
  // parameters we were handed ARE what V22 writes to the file, so they go
  // straight back out.
  return { ...rebuildModel(kind, params, isClassification), toJSON: () => params };
}

function rebuildModel(kind: string, p: any, isClassification: boolean): TrainedModel {
  if (kind === 'baseline') {
    if (p.task === 'regression') return { predict: (X) => X.map(() => p.mean as number) };
    const frequencies = p.frequencies as number[];
    return {
      predict: (X) => X.map(() => p.majority as number),
      predictProba: (X) => X.map(() => [...frequencies]),
    };
  }
  if (kind === 'linear') {
    const weights = [p.intercept as number, ...(p.weights as number[])];
    return {
      predict: (rows) =>
        rows.map((row) => [1, ...row].reduce((acc, v, j) => acc + v * weights[j], 0)),
    };
  }
  if (kind === 'logistic') {
    const weights = p.weights as number[][];
    const proba = (rows: number[][]) =>
      rows.map((row) => {
        const withBias = [1, ...row];
        return softmax(weights.map((w) => w.reduce((acc, v, j) => acc + v * withBias[j], 0)));
      });
    return { predict: argmaxRows(proba), predictProba: proba };
  }
  if (kind === 'naiveBayes') {
    const logPriors = p.logPriors as number[];
    const means = p.means as number[][];
    const variances = p.variances as number[][];
    const proba = (rows: number[][]) =>
      rows.map((row) =>
        softmax(
          logPriors.map((prior, c) => {
            let sum = prior;
            for (let j = 0; j < row.length; j++) {
              const variance = variances[c][j];
              sum +=
                -0.5 * Math.log(2 * Math.PI * variance) -
                (row[j] - means[c][j]) ** 2 / (2 * variance);
            }
            return sum;
          }),
        ),
      );
    return { predict: argmaxRows(proba), predictProba: proba };
  }
  if (kind === 'tree') {
    const model = isClassification
      ? loadable(DecisionTreeClassifier).load(p.model)
      : loadable(DecisionTreeRegression).load(p.model);
    return { predict: (rows) => model.predict(rows) };
  }
  if (kind === 'forest') {
    const model = isClassification
      ? loadable(RandomForestClassifier).load(p.model)
      : loadable(RandomForestRegression).load(p.model);
    return { predict: (rows) => model.predict(rows) };
  }
  if (kind === 'gbdt') {
    const learningRate = p.learningRate as number;
    if (p.task === 'regression') {
      return {
        predict: gbdtRawPredictor(
          p.trees as GbdtTree[],
          p.baseScore as number,
          p.edges as number[][],
          learningRate,
        ),
      };
    }
    const boosters = (
      p.boosters as { baseScore: number; trees: GbdtTree[]; edges: number[][] }[]
    ).map((b) => gbdtRawPredictor(b.trees, b.baseScore, b.edges, learningRate));
    const proba = (rows: number[][]) => {
      if (boosters.length === 1) {
        const p1 = boosters[0](rows).map(gbdtSigmoid);
        return p1.map((v) => [1 - v, v]);
      }
      const raw = boosters.map((booster) => booster(rows).map(gbdtSigmoid));
      return rows.map((_, i) => {
        const scores = raw.map((column) => column[i]);
        const sum = scores.reduce((a, v) => a + v, 0) || 1;
        return scores.map((v) => v / sum);
      });
    };
    return { predict: argmaxRows(proba), predictProba: proba };
  }
  if (kind === 'mlp') {
    const W1 = p.W1 as number[];
    const b1 = p.b1 as number[];
    const W2 = p.W2 as number[];
    const b2 = p.b2 as number[];
    const hidden = b1.length;
    const outputs = b2.length;
    const yMean = p.yMean as number;
    const yStd = p.yStd as number;
    const forward = (rows: number[][]) =>
      rows.map((row) => {
        const activations: number[] = [];
        for (let h = 0; h < hidden; h++) {
          let sum = b1[h];
          for (let j = 0; j < row.length; j++) sum += row[j] * W1[j * hidden + h];
          activations.push(sum > 0 ? sum : 0);
        }
        const out: number[] = [];
        for (let o = 0; o < outputs; o++) {
          let sum = b2[o];
          for (let h = 0; h < hidden; h++) sum += activations[h] * W2[h * outputs + o];
          out.push(sum);
        }
        return isClassification ? softmax(out) : out.map((v) => v * yStd + yMean);
      });
    if (!isClassification) return { predict: (rows) => forward(rows).map((v) => v[0]) };
    return { predict: argmaxRows(forward), predictProba: forward };
  }
  throw new Error(`unsupported-kind:${kind}`);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function deserializeModel(text: string): ImportedModel {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('invalid-json');
  }
  if (typeof raw !== 'object' || raw === null) throw new Error('invalid-json');
  const data = raw as Record<string, unknown>;
  if (data.app !== 'LabML') throw new Error('not-labml');
  // v2 (v22) and v3 (v24, adds TF-IDF text specs) both carry a full pipeline
  // manifest, so both stay importable; v1 predates it and cannot score a CSV.
  if (data.formatVersion !== 2 && data.formatVersion !== 3) {
    throw new Error(`unsupported-version:${String(data.formatVersion ?? '?')}`);
  }
  const parameters = data.parameters as { kind?: string } | undefined;
  const pipeline = data.pipeline as { specs?: PipelineSpecJson[] } | undefined;
  if (
    typeof data.model !== 'string' ||
    typeof data.target !== 'string' ||
    !parameters?.kind ||
    !Array.isArray(pipeline?.specs)
  ) {
    throw new Error('bad-manifest');
  }

  const isClassification = data.task === 'classification';
  const specs = specsFromJson(pipeline.specs);
  const { transformRow } = buildRowEncoder(specs);
  const model = rebuildModel(parameters.kind, parameters, isClassification);

  return {
    manifest: {
      model: data.model as ModelKey,
      isClassification,
      target: data.target,
      classes: Array.isArray(data.classes) ? (data.classes as string[]) : [],
      seed: typeof data.seed === 'number' ? data.seed : 0,
      createdAt: typeof data.createdAt === 'number' ? data.createdAt : null,
      sourceDataset:
        data.sourceDataset && typeof data.sourceDataset === 'object'
          ? (data.sourceDataset as { name: string; rowCount: number })
          : null,
      testMetrics: (data.testMetrics as MetricMap) ?? {},
      testRows: typeof data.testRows === 'number' ? data.testRows : null,
      featureColumns: [...new Set(specs.map((spec) => spec.name))],
    },
    model,
    specs,
    transformRow,
  };
}

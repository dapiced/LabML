/**
 * V37: one helper worker that trains a SUBSET of the model families.
 *
 * Why a second worker type at all: the zoo trains sequentially in a single
 * worker, and the measurement (see PLAN V37) says four families carry 97% of
 * the cost and are roughly the same size — so N workers really do mean N
 * cores here, not a rounding error.
 *
 * The constraint that shapes the protocol: a TrainedModel cannot cross a
 * worker boundary. `predict` is a closure and structured clone drops
 * functions. So this worker returns `toJSON()` and the caller rebuilds the
 * predictor through the V22 deserialisation path — which also means a
 * parallel run and an imported model are provably the same object.
 *
 * k-NN is deliberately NOT trainable here: it is the one family with no
 * `toJSON` (it keeps its training rows), and it is also the one that costs
 * 0 ms to fit. It stays in the main worker, where it belongs.
 *
 * Each worker re-derives the splits and the pipeline from the same seeded
 * config, so nothing large is cloned in: the same seed gives the same rows,
 * which is the whole point of seeding everything.
 */
import { profileColumn } from '@/features/ml/data/profile';
import { MODEL_TRAIN_CAPS, modelZoo } from '@/features/ml/train/models';
import { fitPipeline } from '@/features/ml/train/pipeline';
import { nestedSampleOrder } from '@/features/ml/train/random';
import { balancedWeights } from '@/features/ml/train/class-weight';
import { prepareData, scoreModel } from '@/features/ml/train/trainer';
import type { Cell } from '@/features/ml/data/types';
import type { MetricMap, ModelKey, TrainConfig } from '@/features/ml/train/types';

/** Families this worker will never train — see the k-NN note above. */
export const NOT_PARALLELISABLE: ReadonlySet<ModelKey> = new Set<ModelKey>(['knn']);

export interface FamilyRequest {
  header: string[];
  columns: Cell[][];
  config: TrainConfig;
  families: ModelKey[];
}

export interface FamilyOutcome {
  key: ModelKey;
  ok: boolean;
  error?: string;
  /**
   * `toJSON()` of the fitted model, as a JSON STRING — rebuilt by the caller
   * through the V22 path. A string, not an object, and that is not a detail:
   * structured clone keeps shapes JSON drops, and ml-cart's `load()` silently
   * rebuilds a tree whose `classify` returns a plain object instead of a
   * matrix. Measured: a structured-cloned tree throws
   * `this.root.classify(...).maxRowIndex is not a function` on its first
   * prediction. Going through JSON makes a parallel model byte-identical to an
   * imported one — which is exactly what this protocol claims.
   */
  serialized?: { kind: string; json: string };
  metrics?: MetricMap;
  primary?: number;
  valMetrics?: MetricMap;
  valPrimary?: number;
  trainMs?: number;
  trainedRows?: number;
}

export type FamilyResponse =
  | { kind: 'family-done'; outcome: FamilyOutcome }
  | { kind: 'batch-done' }
  | { kind: 'batch-error'; message: string };

function post(message: FamilyResponse): void {
  (self as unknown as Worker).postMessage(message);
}

self.onmessage = (event: MessageEvent<FamilyRequest>) => {
  const { header, columns, config, families } = event.data;
  try {
    const map = new Map<string, Cell[]>();
    header.forEach((name, i) => map.set(name, columns[i]));
    const profiles = header.map((name, i) => profileColumn(name, columns[i]));

    const prepared = prepareData(map, profiles, config);
    const { isClassification, classes, featureColumns, encode } = prepared;
    const pipeline = fitPipeline(map, profiles, featureColumns, prepared.train);
    const trainX = pipeline.transform(prepared.train);
    const trainY = prepared.train.map(encode);
    const testX = pipeline.transform(prepared.test);
    const testY = prepared.test.map(encode);
    const valX = prepared.validation.length > 0 ? pipeline.transform(prepared.validation) : null;
    const valY = prepared.validation.length > 0 ? prepared.validation.map(encode) : null;

    const weights =
      config.classWeighting === 'balanced' && isClassification
        ? balancedWeights(trainY, classes.length)
        : undefined;
    const context = {
      task: isClassification ? ('classification' as const) : ('regression' as const),
      classCount: classes.length,
      seed: config.seed,
      ...(weights !== undefined && { classWeights: weights }),
    };

    // The SAME seeded order the sequential trainer uses, so a capped family
    // sees the same rows whichever path trained it.
    let sampleOrder: number[] | null = null;
    const zoo = modelZoo(isClassification ? 'classification' : 'regression');

    for (const key of families) {
      const def = zoo.find((d) => d.key === key);
      if (!def || NOT_PARALLELISABLE.has(key)) {
        post({ kind: 'family-done', outcome: { key, ok: false, error: 'not-parallelisable' } });
        continue;
      }
      try {
        const cap = MODEL_TRAIN_CAPS[key];
        let fitX = trainX;
        let fitY = trainY;
        if (cap !== undefined && trainX.length > cap) {
          sampleOrder ??= nestedSampleOrder(trainX.length, prepared.trainLabels, config.seed);
          const keep = sampleOrder.slice(0, cap).sort((a, b) => a - b);
          fitX = keep.map((position) => trainX[position]);
          fitY = keep.map((position) => trainY[position]);
        }
        const started = performance.now();
        const model = def.train(fitX, fitY, context);
        const trainMs = performance.now() - started;

        const serialized = model.toJSON?.() as { kind?: string } | undefined;
        if (serialized === undefined || typeof serialized.kind !== 'string') {
          // Refused by name rather than returning a model the caller cannot
          // rebuild — the sequential path will train this family instead.
          post({ kind: 'family-done', outcome: { key, ok: false, error: 'not-serialisable' } });
          continue;
        }
        const test = scoreModel(model, testX, testY, isClassification, classes.length);
        const validation =
          valX !== null && valY !== null
            ? scoreModel(model, valX, valY, isClassification, classes.length)
            : null;

        post({
          kind: 'family-done',
          outcome: {
            key,
            ok: true,
            serialized: { kind: serialized.kind, json: JSON.stringify(serialized) },
            metrics: test.metrics,
            primary: test.primary,
            trainMs,
            trainedRows: fitX.length,
            ...(validation !== null && {
              valMetrics: validation.metrics,
              valPrimary: validation.primary,
            }),
          },
        });
      } catch (error) {
        post({
          kind: 'family-done',
          outcome: {
            key,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }
    post({ kind: 'batch-done' });
  } catch (error) {
    post({
      kind: 'batch-error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

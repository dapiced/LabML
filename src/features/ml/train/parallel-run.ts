/**
 * V37: runs the heavy families in helper workers and hands the results back
 * as rebuilt predictors. Called from the ML worker; see parallel.ts for the
 * measurement and the three rules this follows.
 *
 * Everything here is best-effort by design: any failure — no Worker support,
 * a helper that throws, a family that comes back unserialisable — simply
 * leaves that family out of the returned map, and the sequential trainer
 * fits it as it always did. Parallelism must never change WHICH models a run
 * produces, only how long it takes to produce them.
 *
 * V55: best-effort no longer means silent. Each of those fallbacks is noted in
 * the run's journal, so a run that took the slow path says which one and why.
 */
import { rebuildTrainedModel } from '@/features/ml/train/deserialize';
import type { Journal } from '@/features/ml/train/journal';
import { modelZoo } from '@/features/ml/train/models';
import { familyCost, helperCount, planBatches } from '@/features/ml/train/parallel';
import type { Cell } from '@/features/ml/data/types';
import type { FamilyRequest, FamilyResponse } from '@/features/ml/train/family.worker';
import type { PretrainedFamily } from '@/features/ml/train/trainer';
import type { ModelKey, TrainConfig } from '@/features/ml/train/types';

/**
 * V47: how often the parallel phase looks at the cancel flag. The phase awaits
 * its helpers, so the ML worker's event loop is free and a `cancel-train`
 * message does set the flag — but nothing read it until every helper had
 * finished, and the heavy families are exactly the ones that take longest.
 */
export const CANCEL_POLL_MS = 100;

export interface ParallelReport {
  helpers: number;
  families: ModelKey[];
  /** Wall time of the parallel phase, so the gain can be published. */
  ms: number;
}

export async function trainInParallel(
  header: string[],
  columns: Cell[][],
  config: TrainConfig,
  isClassification: boolean,
  onFamilyDone: (key: ModelKey) => void,
  isCancelled: () => boolean,
  journal?: Journal,
): Promise<{ pretrained: Map<ModelKey, PretrainedFamily>; report: ParallelReport | null }> {
  const empty = { pretrained: new Map<ModelKey, PretrainedFamily>(), report: null };
  if (typeof Worker === 'undefined') return empty;

  const zoo = modelZoo(isClassification ? 'classification' : 'regression').map((d) => d.key);
  const cores = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 2) : 2;
  const helpers = helperCount(zoo, cores);
  if (helpers === 0) return empty;

  const batches = planBatches(
    zoo.filter((key) => familyCost(key) > 1),
    helpers,
    familyCost,
  );
  if (batches.length === 0) return empty;

  const started = performance.now();
  const pretrained = new Map<ModelKey, PretrainedFamily>();
  const workers: Worker[] = [];
  const pending: Array<() => void> = [];
  // V47: on cancel, stop the helpers mid-fit and release every batch at once.
  const poll = setInterval(() => {
    if (!isCancelled()) return;
    for (const worker of workers) worker.terminate();
    for (const release of pending.splice(0)) release();
  }, CANCEL_POLL_MS);

  try {
    await Promise.all(
      batches.map(
        (families) =>
          new Promise<void>((resolve) => {
            pending.push(resolve);
            let worker: Worker;
            try {
              worker = new Worker(new URL('./family.worker.ts', import.meta.url), {
                type: 'module',
              });
            } catch (error) {
              // No helper: the sequential path covers these families.
              journal?.add('helper-unavailable', undefined, error);
              resolve();
              return;
            }
            workers.push(worker);

            const finish = () => resolve();
            // A helper that dies leaves its families to the sequential path.
            const failed = (cause: unknown) => {
              if (!isCancelled()) journal?.add('helper-failed', undefined, cause);
              finish();
            };
            worker.onerror = (event: ErrorEvent) => failed(event.message);
            worker.onmessageerror = () => failed('message could not be read');
            worker.onmessage = (event: MessageEvent<FamilyResponse>) => {
              const message = event.data;
              if (message.kind === 'batch-error') {
                failed(message.message);
                return;
              }
              if (message.kind === 'batch-done') {
                finish();
                return;
              }
              const outcome = message.outcome;
              if (!outcome.ok || outcome.serialized === undefined) return;
              try {
                const model = rebuildTrainedModel(
                  outcome.serialized.kind,
                  JSON.parse(outcome.serialized.json),
                  isClassification,
                );
                pretrained.set(outcome.key, {
                  model,
                  result: {
                    key: outcome.key,
                    ok: true,
                    metrics: outcome.metrics ?? {},
                    primary: outcome.primary ?? Number.NaN,
                    trainMs: outcome.trainMs ?? 0,
                    // Latency is measured in the main worker on the rebuilt
                    // predictor: a helper's timing would describe its own core.
                    inferP50Ms: 0,
                    inferP95Ms: 0,
                    ...(outcome.trainedRows !== undefined && {
                      trainedRows: outcome.trainedRows,
                    }),
                    ...(outcome.valMetrics !== undefined && {
                      valMetrics: outcome.valMetrics,
                      valPrimary: outcome.valPrimary,
                    }),
                  },
                });
                onFamilyDone(outcome.key);
              } catch (error) {
                // Rebuild failed — the sequential trainer fits it again.
                journal?.add('helper-rebuild-failed', outcome.key, error);
              }
            };

            const request: FamilyRequest = { header, columns, config, families };
            worker.postMessage(request);
          }),
      ),
    );
  } finally {
    clearInterval(poll);
    for (const worker of workers) worker.terminate();
  }

  if (isCancelled()) return empty;
  return {
    pretrained,
    report: {
      helpers: batches.length,
      families: [...pretrained.keys()],
      ms: performance.now() - started,
    },
  };
}

import { create } from 'zustand';
import { MAX_FIELD_LENGTH } from '@/features/ml/projects/model-card';
import type { RunArtifacts } from '@/features/ml/projects/types';
import type { ExclusionReason } from '@/features/ml/data/types';
import type { WorkerRequest, WorkerResponse } from '@/features/ml/worker-protocol';
import { evaluateMulticlassPolicy } from '@/features/ml/train/multiclass-decision';
import {
  editMulticlassThreshold,
  isExploratoryTestRequest,
} from '@/features/ml/train/multiclass-decision-state';
import {
  initialData,
  initialTraining,
  TEST_RATIO,
  TRAIN_SEED,
  type LabState,
} from '@/features/ml/store/state';
import { isStaleResponse, isTrainingBusy } from '@/features/ml/store/fence';
import { fileKey, freshSeed, latestSeed, seedDealsTheTest } from '@/features/ml/train/ledger';
import { thresholdArtifact } from '@/features/ml/store/artifacts';
import { createResponseHandlers } from '@/features/ml/store/responses';

export {
  TEST_RATIO,
  TRAIN_SEED,
  type LabStatus,
  type TrainStatus,
} from '@/features/ml/store/state';
export { isStaleResponse, isTrainingBusy } from '@/features/ml/store/fence';

let worker: Worker | null = null;

function terminateWorker() {
  worker?.terminate();
  worker = null;
}

function activeDecisionPolicy(state: LabState) {
  const decision = state.currentRun?.artifacts?.multiclassDecision;
  return decision && decision.model === state.insights?.model ? decision.policy : undefined;
}

export const useLabStore = create<LabState>((set, get) => {
  /**
   * Attach a late analysis (tuning, explanation, exploration, forecast) to the
   * current run so it survives it — in memory and in IndexedDB. Each kind keeps
   * its latest outcome only. No current run (e.g. exploring without training)
   * → the panel state still shows it, it just is not part of any record.
   */
  function attachArtifact(patch: Partial<RunArtifacts>) {
    const current = get().currentRun;
    if (!current) return;
    const artifacts: RunArtifacts = { ...current.artifacts, ...patch };
    set({ currentRun: { ...current, artifacts } });
    if (current.id !== undefined) {
      const id = current.id;
      void import('@/features/ml/projects/db').then(({ db }) => db.runs.update(id, { artifacts }));
    }
  }

  /**
   * Store the rebuilt CSV in IndexedDB (v19 opt-in). Everything is dynamic
   * here — Dexie and lz-string stay out of the initial /ml bundle. Over
   * quota → a NAMED refusal with the numbers, never a trim or a silent drop.
   */
  async function persistDatasetCsv(csv: string) {
    const meta = get().meta;
    if (!meta) return;
    const [{ db }, storage] = await Promise.all([
      import('@/features/ml/projects/db'),
      import('@/features/ml/projects/dataset-storage'),
    ]);
    const packed = storage.packDataset(csv);
    // Transient full read: the quota caps the table at ~50 MB compressed.
    let usedBytes = 0;
    await db.datasets.each((d) => {
      usedBytes += d.storedBytes;
    });
    if (!storage.fitsQuota(usedBytes, packed.storedBytes)) {
      set({
        datasetSaving: false,
        datasetQuotaError: {
          usedBytes,
          neededBytes: packed.storedBytes,
          quotaBytes: storage.DATASET_QUOTA_BYTES,
        },
      });
      return;
    }
    const id = await db.datasets.add({
      name: meta.name,
      rowCount: meta.rowCount,
      columnCount: meta.columnCount,
      originalBytes: packed.originalBytes,
      storedBytes: packed.storedBytes,
      savedAt: Date.now(),
      csv: packed.csv,
    });
    set({ savedDatasetId: id, datasetSaving: false, datasetQuotaError: null });
    // A run trained on this dataset gets linked, in memory and in Dexie.
    const current = get().currentRun;
    if (current) {
      set({ currentRun: { ...current, datasetId: id } });
      if (current.id !== undefined) void db.runs.update(current.id, { datasetId: id });
    }
  }

  function send(request: WorkerRequest) {
    if (!worker) {
      worker = new Worker(new URL('./data/parse.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const message = event.data;
        if (isStaleResponse(message.kind, get().trainStatus)) return;
        // TypeScript cannot correlate `message.kind` with the handler it
        // indexes, so the call is widened once here; the table itself is
        // checked kind by kind in store/responses.ts.
        (handlers[message.kind] as (response: WorkerResponse) => void)(message);
      };
      // V47: a crashed worker is gone — keeping its reference sent every
      // later request into the void, and leaving the busy flags up kept the
      // page spinning forever. The next request starts a fresh worker.
      worker.onerror = () => {
        terminateWorker();
        set({
          status: 'error',
          error: 'worker',
          ...initialTraining,
          datasetSaving: false,
          importedStatus: 'idle',
        });
      };
    }
    worker.postMessage(request);
  }

  const handlers = createResponseHandlers({
    set,
    get,
    send,
    attachArtifact,
    persistDatasetCsv,
  });

  return {
    ...initialData,

    loadFile(file) {
      terminateWorker();
      set({ ...initialData, status: 'parsing' });
      send({ kind: 'parse-file', file });
    },

    loadDemo(fileName) {
      terminateWorker();
      set({ ...initialData, status: 'parsing' });
      send({ kind: 'parse-url', url: `/datasets/${fileName}`, name: fileName });
    },

    saveDataset() {
      const state = get();
      if (state.status !== 'ready' || state.savedDatasetId !== null || state.datasetSaving) return;
      set({ datasetSaving: true, datasetQuotaError: null });
      send({ kind: 'export-dataset' });
    },

    openDataset(id) {
      terminateWorker();
      set({ ...initialData, status: 'parsing', savedDatasetId: id });
      void Promise.all([
        import('@/features/ml/projects/db'),
        import('@/features/ml/projects/dataset-storage'),
      ]).then(async ([{ db }, storage]) => {
        const stored = await db.datasets.get(id);
        const text = stored ? storage.unpackDataset(stored.csv) : null;
        if (!stored || text === null) {
          set({ status: 'error', error: 'dataset-missing', savedDatasetId: null });
          return;
        }
        send({ kind: 'parse-text', text, name: stored.name });
      });
    },

    forgetDataset(id) {
      void import('@/features/ml/projects/db').then(({ db }) => db.datasets.delete(id));
      if (get().savedDatasetId === id) {
        set({ savedDatasetId: null, datasetQuotaError: null });
      }
    },

    importModelFile(file) {
      if (get().importedStatus !== 'idle') return;
      set({ importedStatus: 'loading', importedError: null });
      void file.text().then((text) => send({ kind: 'load-model', text }));
    },

    importedScoreFile(file) {
      const state = get();
      if (!state.importedManifest || state.importedStatus !== 'idle') return;
      set({ importedStatus: 'scoring', importedResult: null, importedError: null });
      send({ kind: 'score-imported-file', file });
    },

    importedScoreDemo(fileName) {
      const state = get();
      if (!state.importedManifest || state.importedStatus !== 'idle') return;
      set({ importedStatus: 'scoring', importedResult: null, importedError: null });
      send({ kind: 'score-imported-url', url: `/datasets/${fileName}`, name: fileName });
    },

    clearImported() {
      set({
        importedManifest: null,
        importedStatus: 'idle',
        importedResult: null,
        importedError: null,
      });
    },

    setTarget(column) {
      if (isTrainingBusy(get())) return;
      set({
        target: column,
        task: null,
        targetUnsupported: null,
        leaks: [],
        // V60: another target is another ledger, and starts on the first split
        // until its own ledger says which split was dealt last.
        seed: TRAIN_SEED,
        ledgerEntries: [],
        ...initialTraining,
      });
      if (column) {
        send({ kind: 'analyze-target', target: column });
        const meta = get().meta;
        if (meta) {
          const file = fileKey(meta, column);
          void import('@/features/ml/projects/ledger-db')
            .then(({ loadLedger }) => loadLedger(file))
            .then((entries) => {
              const now = get();
              // The answer is for the file and target it was asked for, and it
              // must not move the split under a run that already started.
              if (!now.meta || now.target !== column || fileKey(now.meta, column) !== file) return;
              if (now.trainStatus !== 'idle') return;
              set({ ledgerEntries: entries, seed: latestSeed(entries, TRAIN_SEED) });
            })
            // No IndexedDB (private mode, a test): the lab trains without a ledger.
            .catch(() => undefined);
        }
      }
    },

    toggleColumn(column) {
      const state = get();
      if (isTrainingBusy(state)) return;
      const overrides = { ...state.overrides };
      const excluded = effectiveExclusion(state, column) !== null;
      if (overrides[column]) {
        delete overrides[column];
      } else {
        overrides[column] = excluded ? 'include' : 'exclude';
      }
      // Changing the feature set invalidates any existing leaderboard.
      set({ overrides, ...initialTraining });
    },

    train() {
      const state = get();
      if (!state.target || !state.task || state.trainStatus === 'training') return;
      const features = state.profiles
        .map((p) => p.name)
        .filter((name) => name !== state.target && effectiveExclusion(state, name) === null);
      set({ ...initialTraining, trainStatus: 'training' });
      send({
        kind: 'train',
        config: {
          target: state.target,
          features,
          seed: state.seed,
          testRatio: TEST_RATIO,
          ...(state.splitChoice !== null && { split: state.splitChoice }),
          ...(state.classWeighting && { classWeighting: 'balanced' as const }),
        },
      });
    },

    cancelTrain() {
      if (get().trainStatus !== 'training') return;
      send({ kind: 'cancel-train' });
    },

    selectInsightModel(model) {
      const state = get();
      if (state.trainStatus !== 'done' || state.insights?.model === model) return;
      if (!state.results.some((r) => r.ok && r.key === model)) return;
      // Batch score, threshold and segment analyses belong to the previous model.
      set({
        insights: null,
        whatIf: null,
        explanation: null,
        batchStatus: 'idle',
        batchResult: null,
        batchError: null,
        thresholdAnalysis: null,
        thresholdChoice: { threshold: 0.5, costFp: 1, costFn: 1 },
        multiclassDecision: null,
        multiclassDecisionTestPending: false,
        multiclassDecisionUnavailable: false,
        segmentAnalysis: null,
        conformalAnalysis: null,
        // V59: an audit describes one model; another model, another audit.
        groupAudit: null,
        groupAuditColumn: null,
        groupAuditPending: false,
      });
      send({ kind: 'model-insights', model });
    },

    requestWhatIf(values) {
      const state = get();
      if (state.trainStatus !== 'done' || !state.insights) return;
      send({ kind: 'what-if', model: state.insights.model, values });
    },

    requestExplanation(values) {
      const state = get();
      if (state.trainStatus !== 'done' || !state.insights) return;
      send({ kind: 'explain', model: state.insights.model, values });
    },

    tune(model) {
      const state = get();
      if (!state.target || state.trainStatus !== 'done' || state.tuneStatus === 'running') return;
      const features = state.profiles
        .map((p) => p.name)
        .filter((name) => name !== state.target && effectiveExclusion(state, name) === null);
      set({ tuneStatus: 'running', tuneProgress: null, tuneOutcome: null });
      send({
        kind: 'tune',
        model,
        config: {
          target: state.target,
          features,
          seed: state.seed,
          testRatio: TEST_RATIO,
          ...(state.splitChoice !== null && { split: state.splitChoice }),
          ...(state.classWeighting && { classWeighting: 'balanced' as const }),
        },
      });
    },

    cancelTune() {
      if (get().tuneStatus !== 'running') return;
      send({ kind: 'cancel-tune' });
    },

    learningCurve(model) {
      const state = get();
      if (!state.target || state.trainStatus !== 'done' || state.curveStatus === 'running') return;
      const features = state.profiles
        .map((p) => p.name)
        .filter((name) => name !== state.target && effectiveExclusion(state, name) === null);
      set({ curveStatus: 'running', curveProgress: null, curveOutcome: null });
      send({
        kind: 'learning-curve',
        model,
        config: {
          target: state.target,
          features,
          seed: state.seed,
          testRatio: TEST_RATIO,
          ...(state.splitChoice !== null && { split: state.splitChoice }),
          ...(state.classWeighting && { classWeighting: 'balanced' as const }),
        },
      });
    },

    cancelCurve() {
      if (get().curveStatus !== 'running') return;
      send({ kind: 'cancel-curve' });
    },

    robustRank() {
      const state = get();
      if (!state.target || state.trainStatus !== 'done' || state.robustStatus === 'running') return;
      const features = state.profiles
        .map((p) => p.name)
        .filter((name) => name !== state.target && effectiveExclusion(state, name) === null);
      set({ robustStatus: 'running', robustProgress: null, robustOutcome: null });
      send({
        kind: 'robust-rank',
        config: {
          target: state.target,
          features,
          seed: state.seed,
          testRatio: TEST_RATIO,
          ...(state.splitChoice !== null && { split: state.splitChoice }),
          ...(state.classWeighting && { classWeighting: 'balanced' as const }),
        },
      });
    },

    cancelRobust() {
      if (get().robustStatus !== 'running') return;
      send({ kind: 'cancel-robust' });
    },

    setSplitChoice(choice) {
      if (get().trainStatus === 'training') return;
      set({ splitChoice: choice });
    },

    drawFreshSplit() {
      const state = get();
      if (isTrainingBusy(state) || !seedDealsTheTest(state.splitChoice)) return;
      set({ seed: freshSeed(state.ledgerEntries, state.seed), ...initialTraining });
    },

    setClassWeighting(on) {
      if (get().trainStatus === 'training') return;
      set({ classWeighting: on });
    },

    // Ranking is a reading of results already computed — no retraining.
    setRankMetric(metric) {
      set({ rankMetric: metric });
    },

    // V58: the card's typed fields live in the run record, like the artifacts:
    // in memory at once, in IndexedDB when the run has been stored.
    setCardField(field, value) {
      const current = get().currentRun;
      if (!current) return;
      const card = { ...current.card, [field]: value.slice(0, MAX_FIELD_LENGTH) };
      set({ currentRun: { ...current, card } });
      if (current.id !== undefined) {
        const id = current.id;
        void import('@/features/ml/projects/db').then(({ db }) => db.runs.update(id, { card }));
      }
    },

    // V59: nothing here runs on its own. The lab does not decide which column
    // is sensitive, so the audit waits for the user to name one.
    auditGroups(column) {
      const state = get();
      if (state.trainStatus !== 'done' || !state.insights) return;
      if (column === null) {
        set({ groupAudit: null, groupAuditColumn: null, groupAuditPending: false });
        return;
      }
      set({ groupAudit: null, groupAuditColumn: column, groupAuditPending: true });
      // The decision audited is the one the user set: the chosen threshold of
      // a binary model when there is one, the model's own answer otherwise.
      const cut =
        state.thresholdAnalysis &&
        !state.thresholdAnalysis.oneVsRest &&
        state.thresholdAnalysis.model === state.insights.model &&
        state.thresholdChoice.threshold !== 0.5
          ? state.thresholdChoice.threshold
          : undefined;
      send({
        kind: 'group-audit',
        model: state.insights.model,
        column,
        ...(cut !== undefined && { threshold: cut }),
      });
    },

    // V57: another coverage target is another reading of the same model.
    setConformalLevel(alpha) {
      const state = get();
      if (state.conformalAlpha === alpha || state.trainStatus !== 'done') return;
      set({ conformalAlpha: alpha, conformalAnalysis: null });
      if (state.insights) {
        send({ kind: 'conformal-analysis', model: state.insights.model, alpha });
      }
    },

    setThresholdClass(index) {
      const state = get();
      if (state.thresholdClass === index || state.trainStatus !== 'done') return;
      set({ thresholdClass: index, thresholdAnalysis: null });
      if (state.insights) {
        send({ kind: 'threshold-analysis', model: state.insights.model, focusClass: index });
      }
    },

    explore() {
      const state = get();
      if (state.status !== 'ready' || state.exploreStatus === 'running') return;
      const features = state.profiles
        .map((p) => p.name)
        .filter((name) => effectiveExclusion(state, name) === null && name !== state.target);
      set({ exploreStatus: 'running', exploration: null });
      send({ kind: 'explore', features, seed: TRAIN_SEED });
    },

    forecast(dateColumn, valueColumn) {
      const state = get();
      if (state.status !== 'ready' || state.forecastStatus === 'running') return;
      set({ forecastStatus: 'running', forecastPayload: null });
      send({ kind: 'forecast', dateColumn, valueColumn });
    },

    scoreBatch(file) {
      const state = get();
      if (state.trainStatus !== 'done' || !state.insights || state.batchStatus === 'scoring')
        return;
      set({ batchStatus: 'scoring', batchResult: null, batchError: null });
      const decisionPolicy = activeDecisionPolicy(state);
      send({
        kind: 'score-batch-file',
        file,
        model: state.insights.model,
        ...(decisionPolicy ? { decisionPolicy } : {}),
      });
    },

    chooseThreshold(partial) {
      const state = get();
      if (!state.thresholdAnalysis) return;
      const choice = { ...state.thresholdChoice, ...partial };
      set({ thresholdChoice: choice });
      attachArtifact({ threshold: thresholdArtifact(state.thresholdAnalysis, choice) });
    },

    setMulticlassThreshold(classIndex, threshold) {
      const state = get();
      const current = state.multiclassDecision;
      if (
        state.multiclassDecisionTestPending ||
        !current ||
        classIndex < 0 ||
        classIndex >= current.analysis.classes.length
      )
        return;
      const editor = editMulticlassThreshold(current.editor, classIndex, threshold);
      // Evaluation remains local and validation-only while sliders move.
      evaluateMulticlassPolicy(
        current.analysis.validationLabels,
        current.analysis.validationProbabilities,
        editor.policy,
      );
      set({ multiclassDecision: { ...current, editor } });
    },

    testMulticlassDecision() {
      const state = get();
      const current = state.multiclassDecision;
      if (!current || state.multiclassDecisionTestPending) return;
      set({ multiclassDecisionTestPending: true });
      send({
        kind: 'multiclass-decision-test',
        model: current.analysis.model,
        policy: current.editor.policy,
        exploratory: isExploratoryTestRequest(current.editor),
      });
    },

    scoreBatchDemo(fileName) {
      const state = get();
      if (state.trainStatus !== 'done' || !state.insights || state.batchStatus === 'scoring')
        return;
      set({ batchStatus: 'scoring', batchResult: null, batchError: null });
      const decisionPolicy = activeDecisionPolicy(state);
      send({
        kind: 'score-batch-url',
        url: `/datasets/${fileName}`,
        name: fileName,
        model: state.insights.model,
        ...(decisionPolicy ? { decisionPolicy } : {}),
      });
    },

    exportModel() {
      const state = get();
      if (state.trainStatus !== 'done' || !state.insights) return;
      const decisionPolicy = activeDecisionPolicy(state);
      send({
        kind: 'export-model',
        model: state.insights.model,
        ...(decisionPolicy ? { decisionPolicy } : {}),
      });
    },

    exportPredictions() {
      const state = get();
      if (state.trainStatus !== 'done' || !state.insights) return;
      send({ kind: 'export-predictions', model: state.insights.model });
    },

    exportPython() {
      const state = get();
      if (state.trainStatus !== 'done' || !state.summary) return;
      send({
        kind: 'export-python',
        appVersion: __APP_VERSION__,
        classWeighting: state.summary.classWeighting === 'balanced',
        models: state.results
          .filter((result) => result.ok)
          .map((result) => ({
            key: result.key,
            metrics: result.metrics,
            ...(result.trainedRows !== undefined && { trainedRows: result.trainedRows }),
          })),
      });
    },

    clearExportedFile() {
      set({ exportedFile: null });
    },

    reset() {
      terminateWorker();
      set({ ...initialData });
    },
  };
});

/**
 * Why a column is currently excluded: a manual choice, a baseline suggestion,
 * or a target-leak flag — null when the column is part of the training set.
 */
export function effectiveExclusion(
  state: Pick<LabState, 'baseline' | 'leaks' | 'overrides' | 'target'>,
  column: string,
): ExclusionReason | 'manual' | null {
  if (column === state.target) return null;
  const override = state.overrides[column];
  if (override === 'include') return null;
  if (override === 'exclude') return 'manual';
  const suggestion =
    state.leaks.find((s) => s.column === column) ?? state.baseline.find((s) => s.column === column);
  return suggestion?.reason ?? null;
}

/**
 * V51 — what the store does with each answer from the ML worker.
 *
 * This was a 250-line `if / else if` chain inside `onmessage`, whose last
 * `else` silently caught every kind nobody had listed. It is now a table with
 * one entry per `WorkerResponse` kind, typed so that the compiler refuses a
 * kind with no handler and a handler for a kind that does not exist. The
 * bodies are moved unchanged.
 */
import type { StoreApi } from 'zustand';
import type { RunArtifacts, RunRecord } from '@/features/ml/projects/types';
import type { BatchScore } from '@/features/ml/train/score';
import type { WorkerRequest, WorkerResponse } from '@/features/ml/worker-protocol';
import { bestResult } from '@/features/ml/train/ranking';
import { evaluateMulticlassPolicy } from '@/features/ml/train/multiclass-decision';
import { receiveMulticlassDecisionTest } from '@/features/ml/train/multiclass-decision-state';
import { thresholdArtifact } from '@/features/ml/store/artifacts';
import { initialTraining, type LabState } from '@/features/ml/store/state';

export interface ResponseContext {
  set: StoreApi<LabState>['setState'];
  get: () => LabState;
  send: (request: WorkerRequest) => void;
  attachArtifact: (patch: Partial<RunArtifacts>) => void;
  persistDatasetCsv: (csv: string) => Promise<void>;
}

export type ResponseHandlers = {
  [K in WorkerResponse['kind']]: (message: Extract<WorkerResponse, { kind: K }>) => void;
};

export function createResponseHandlers({
  set,
  get,
  send,
  attachArtifact,
  persistDatasetCsv,
}: ResponseContext): ResponseHandlers {
  return {
    progress: (message) => {
      set({ rowsParsed: message.rows });
    },
    parsed: (message) => {
      const { meta, profiles, preview, suggestions, readFormat } = message.payload;
      set({
        status: 'ready',
        meta,
        profiles,
        preview,
        baseline: suggestions,
        readFormat: readFormat ?? null,
        rowsParsed: meta.rowCount,
      });
    },
    'target-analyzed': (message) => {
      set({
        task: message.payload.task,
        targetUnsupported: message.payload.unsupportedReason ?? null,
        leaks: message.payload.suggestions,
      });
    },
    'model-start': (message) => {
      set({
        trainStatus: 'training',
        modelProgress: { key: message.key, index: message.index, total: message.total },
      });
    },
    'model-result': (message) => {
      set({ results: [...get().results, message.result] });
    },
    'train-complete': (message) => {
      set({ trainStatus: 'done', modelProgress: null, summary: message.summary });
      // Fetch insights for the winning model right away.
      // V35: the SAME ranking rule as the leaderboard — otherwise the
      // table crowns one model and the insights panel opens another.
      const best = bestResult(get().results, message.summary.taskType);
      if (best !== null) {
        send({ kind: 'model-insights', model: best.key });
        // Leaderboard-wide intervals ride along with every completed run.
        send({ kind: 'uncertainty-analysis' });
      }
    },
    'train-cancelled': () => {
      set({ ...initialTraining });
    },
    insights: (message) => {
      set({ insights: message.payload, whatIf: null });
      // Imbalance tools ride along; the worker answers null when N/A.
      send({
        kind: 'threshold-analysis',
        model: message.payload.model,
        focusClass: get().thresholdClass,
      });
      send({ kind: 'multiclass-decision-analysis', model: message.payload.model });
      send({ kind: 'segment-analysis', model: message.payload.model });
      // First insights after a completed run = winning model → auto-save.
      const state = get();
      if (
        state.trainStatus === 'done' &&
        state.currentRun === null &&
        state.meta &&
        state.target &&
        state.task &&
        state.summary
      ) {
        const createdAt = Date.now();
        const record: RunRecord = {
          name: `${state.meta.name.replace(/\.[a-z]+$/i, '')} · ${state.target}`,
          createdAt,
          dataset: {
            name: state.meta.name,
            rowCount: state.meta.rowCount,
            columnCount: state.meta.columnCount,
          },
          target: state.target,
          taskType: state.task.type,
          seed: state.summary.seed,
          results: state.results,
          summary: state.summary,
          insights: message.payload,
          ...(state.savedDatasetId !== null ? { datasetId: state.savedDatasetId } : {}),
        };
        set({ currentRun: record });
        // Dexie is loaded on demand so /ml renders without it.
        void import('@/features/ml/projects/db').then(({ db }) =>
          db.runs.add(record).then((id) => {
            // Match by createdAt: an artifact may have replaced the object
            // meanwhile — keep it, and persist what it attached.
            const current = get().currentRun;
            if (current && current.createdAt === record.createdAt) {
              set({ currentRun: { ...current, id } });
              if (current.artifacts) {
                void db.runs.update(id, { artifacts: current.artifacts });
              }
            }
          }),
        );
      }
    },
    'what-if-result': (message) => {
      set({ whatIf: message.payload, explanation: null });
    },
    explanation: (message) => {
      set({ explanation: message.payload });
      attachArtifact({ explanation: message.payload });
    },
    'tune-progress': (message) => {
      set({
        tuneProgress: { done: message.done, total: message.total, bestCv: message.bestCv },
      });
    },
    'tune-complete': (message) => {
      set({ tuneStatus: 'done', tuneProgress: null, tuneOutcome: message.payload });
      attachArtifact({ tuning: message.payload });
    },
    'tune-cancelled': () => {
      set({ tuneStatus: 'idle', tuneProgress: null });
    },
    'curve-progress': (message) => {
      set({ curveProgress: { done: message.done, total: message.total } });
    },
    'curve-complete': (message) => {
      set({ curveStatus: 'done', curveProgress: null, curveOutcome: message.payload });
      if (message.payload) attachArtifact({ learningCurve: message.payload });
    },
    'curve-cancelled': () => {
      set({ curveStatus: 'idle', curveProgress: null });
    },
    'robust-progress': (message) => {
      set({ robustProgress: { done: message.done, total: message.total } });
    },
    'robust-complete': (message) => {
      set({ robustStatus: 'done', robustProgress: null, robustOutcome: message.payload });
      attachArtifact({ robustRank: message.payload });
    },
    'robust-cancelled': () => {
      set({ robustStatus: 'idle', robustProgress: null });
    },
    'explore-result': (message) => {
      set({ exploreStatus: 'done', exploration: message.payload });
      attachArtifact({ exploration: message.payload });
    },
    'forecast-result': (message) => {
      set({ forecastStatus: 'done', forecastPayload: message.payload });
      attachArtifact({ forecast: message.payload });
    },
    'batch-scored': (message) => {
      set({ batchStatus: 'done', batchResult: message.payload, batchError: null });
      // The record keeps the numbers, never the row-level CSV.
      const artifact = { ...message.payload } as Partial<BatchScore>;
      delete artifact.csv;
      delete artifact.preview;
      attachArtifact({ batchScore: artifact as Omit<BatchScore, 'csv' | 'preview'> });
    },
    'batch-error': (message) => {
      set({ batchStatus: 'error', batchResult: null, batchError: message.message });
    },
    'model-loaded': (message) => {
      set({
        importedManifest: message.manifest,
        importedStatus: 'idle',
        importedResult: null,
        importedError: null,
      });
    },
    'imported-scored': (message) => {
      set({ importedResult: message.payload, importedStatus: 'idle', importedError: null });
    },
    'import-error': (message) => {
      set({ importedError: message.message, importedStatus: 'idle' });
    },
    'threshold-result': (message) => {
      const choice = { threshold: 0.5, costFp: 1, costFn: 1 };
      set({ thresholdAnalysis: message.payload, thresholdChoice: choice });
      if (message.payload) {
        attachArtifact({ threshold: thresholdArtifact(message.payload, choice) });
      }
    },
    'multiclass-decision-result': (message) => {
      const analysis = message.payload;
      set({
        multiclassDecisionTestPending: false,
        multiclassDecisionUnavailable: analysis === null && (get().task?.classes?.length ?? 0) > 2,
        multiclassDecision: analysis
          ? {
              analysis,
              editor: {
                policy: { thresholds: analysis.classes.map(() => 0) },
                phase: 'draft',
                test: null,
              },
            }
          : null,
      });
    },
    'multiclass-decision-tested': (message) => {
      const state = get();
      const current = state.multiclassDecision;
      if (
        current &&
        state.multiclassDecisionTestPending &&
        current.analysis.model === message.model
      ) {
        const editor = receiveMulticlassDecisionTest(current.editor, message.payload);
        const validation = evaluateMulticlassPolicy(
          current.analysis.validationLabels,
          current.analysis.validationProbabilities,
          editor.policy,
        );
        set({
          multiclassDecision: { ...current, editor },
          multiclassDecisionTestPending: false,
        });
        attachArtifact({
          multiclassDecision: {
            model: current.analysis.model,
            classes: current.analysis.classes,
            policy: editor.policy,
            validation,
            test: message.payload.metrics,
            exploratory: editor.phase === 'exploratory',
          },
        });
      }
    },
    'segments-result': (message) => {
      set({ segmentAnalysis: message.payload });
      if (message.payload) {
        attachArtifact({ segments: message.payload });
      }
    },
    'uncertainty-result': (message) => {
      set({ uncertaintyAnalysis: message.payload });
      if (message.payload) {
        attachArtifact({ uncertainty: message.payload });
      }
    },
    'model-json': (message) => {
      if (message.json !== null) {
        set({
          exportedFile: {
            name: `labml-${message.model}.json`,
            mime: 'application/json',
            content: message.json,
          },
        });
      }
    },
    'dataset-csv': (message) => {
      void persistDatasetCsv(message.csv);
    },
    'predictions-csv': (message) => {
      set({
        exportedFile: {
          name: `labml-${message.model}-predictions.csv`,
          mime: 'text/csv',
          content: message.csv,
        },
      });
    },
    error: (message) => {
      set({ status: 'error', error: message.message, ...initialTraining });
    },
  };
}

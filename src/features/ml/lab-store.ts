import { create } from 'zustand';
import { db } from '@/features/ml/projects/db';
import type { RunRecord } from '@/features/ml/projects/types';
import type {
  ColumnSuggestion,
  DatasetMeta,
  ColumnProfile,
  ExclusionReason,
  TaskInfo,
} from '@/features/ml/data/types';
import type { TunableKey, TuneOutcome } from '@/features/ml/train/search';
import type { ExplorationPayload } from '@/features/ml/unsupervised/explore';
import type { ShapleyExplanation } from '@/features/ml/train/shapley';
import type {
  InsightsPayload,
  ModelKey,
  ModelResult,
  TrainSummary,
  WhatIfResult,
} from '@/features/ml/train/types';
import type { WorkerRequest, WorkerResponse } from '@/features/ml/worker-protocol';

export type LabStatus = 'idle' | 'parsing' | 'ready' | 'error';
export type TrainStatus = 'idle' | 'training' | 'done';

export const TRAIN_SEED = 42;
export const TEST_RATIO = 0.2;

interface LabState {
  status: LabStatus;
  error: string | null;
  rowsParsed: number;
  meta: DatasetMeta | null;
  profiles: ColumnProfile[];
  preview: Record<string, string>[];
  /** Target-independent suggestions computed at parse time. */
  baseline: ColumnSuggestion[];
  target: string | null;
  task: TaskInfo | null;
  targetUnsupported: 'type' | 'tooManyClasses' | 'empty' | null;
  /** Target-dependent leak suggestions. */
  leaks: ColumnSuggestion[];
  /** Manual include/exclude decisions that override the suggestions. */
  overrides: Record<string, 'include' | 'exclude'>;
  trainStatus: TrainStatus;
  modelProgress: { key: ModelKey; index: number; total: number } | null;
  results: ModelResult[];
  summary: TrainSummary | null;
  /** Insights bundle for the currently inspected model (defaults to the best). */
  insights: InsightsPayload | null;
  whatIf: WhatIfResult | null;
  /** Shapley explanation of the latest what-if row (cleared with it). */
  explanation: ShapleyExplanation | null;
  tuneStatus: 'idle' | 'running' | 'done';
  tuneProgress: { done: number; total: number; bestCv: number | null } | null;
  tuneOutcome: TuneOutcome | null;
  exploreStatus: 'idle' | 'running' | 'done';
  exploration: ExplorationPayload | null;
  /** The auto-saved record of the current run (id set once stored). */
  currentRun: RunRecord | null;
  /** File produced by an export action, consumed once by the UI download effect. */
  exportedFile: { name: string; mime: string; content: string } | null;
  loadFile: (file: File) => void;
  loadDemo: (fileName: string) => void;
  setTarget: (column: string | null) => void;
  toggleColumn: (column: string) => void;
  train: () => void;
  cancelTrain: () => void;
  selectInsightModel: (model: ModelKey) => void;
  requestWhatIf: (values: Record<string, string>) => void;
  requestExplanation: (values: Record<string, string>) => void;
  tune: (model: TunableKey) => void;
  cancelTune: () => void;
  explore: () => void;
  exportModel: () => void;
  exportPredictions: () => void;
  clearExportedFile: () => void;
  reset: () => void;
}

let worker: Worker | null = null;

function terminateWorker() {
  worker?.terminate();
  worker = null;
}

const initialTraining = {
  trainStatus: 'idle' as TrainStatus,
  modelProgress: null,
  results: [],
  summary: null,
  insights: null,
  whatIf: null,
  explanation: null,
  tuneStatus: 'idle' as const,
  tuneProgress: null,
  tuneOutcome: null,
  exploreStatus: 'idle' as const,
  exploration: null,
  currentRun: null,
  exportedFile: null,
};

const initialData = {
  status: 'idle' as LabStatus,
  error: null,
  rowsParsed: 0,
  meta: null,
  profiles: [],
  preview: [],
  baseline: [],
  target: null,
  task: null,
  targetUnsupported: null,
  leaks: [],
  overrides: {},
  ...initialTraining,
};

export const useLabStore = create<LabState>((set, get) => {
  function send(request: WorkerRequest) {
    if (!worker) {
      worker = new Worker(new URL('./data/parse.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const message = event.data;
        if (message.kind === 'progress') {
          set({ rowsParsed: message.rows });
        } else if (message.kind === 'parsed') {
          const { meta, profiles, preview, suggestions } = message.payload;
          set({
            status: 'ready',
            meta,
            profiles,
            preview,
            baseline: suggestions,
            rowsParsed: meta.rowCount,
          });
        } else if (message.kind === 'target-analyzed') {
          set({
            task: message.payload.task,
            targetUnsupported: message.payload.unsupportedReason ?? null,
            leaks: message.payload.suggestions,
          });
        } else if (message.kind === 'model-start') {
          set({
            trainStatus: 'training',
            modelProgress: { key: message.key, index: message.index, total: message.total },
          });
        } else if (message.kind === 'model-result') {
          set({ results: [...get().results, message.result] });
        } else if (message.kind === 'train-complete') {
          set({ trainStatus: 'done', modelProgress: null, summary: message.summary });
          // Fetch insights for the winning model right away.
          const ok = get().results.filter((r) => r.ok);
          if (ok.length > 0) {
            const isClassification = message.summary.taskType !== 'regression';
            const best = [...ok].sort((a, b) =>
              isClassification ? b.primary - a.primary : a.primary - b.primary,
            )[0];
            send({ kind: 'model-insights', model: best.key });
          }
        } else if (message.kind === 'train-cancelled') {
          set({ ...initialTraining });
        } else if (message.kind === 'insights') {
          set({ insights: message.payload, whatIf: null });
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
            };
            set({ currentRun: record });
            void db.runs.add(record).then((id) => {
              const current = get().currentRun;
              if (current === record) set({ currentRun: { ...record, id } });
            });
          }
        } else if (message.kind === 'what-if-result') {
          set({ whatIf: message.payload, explanation: null });
        } else if (message.kind === 'explanation') {
          set({ explanation: message.payload });
        } else if (message.kind === 'tune-progress') {
          set({
            tuneProgress: { done: message.done, total: message.total, bestCv: message.bestCv },
          });
        } else if (message.kind === 'tune-complete') {
          set({ tuneStatus: 'done', tuneProgress: null, tuneOutcome: message.payload });
        } else if (message.kind === 'tune-cancelled') {
          set({ tuneStatus: 'idle', tuneProgress: null });
        } else if (message.kind === 'explore-result') {
          set({ exploreStatus: 'done', exploration: message.payload });
        } else if (message.kind === 'model-json') {
          if (message.json !== null) {
            set({
              exportedFile: {
                name: `labml-${message.model}.json`,
                mime: 'application/json',
                content: message.json,
              },
            });
          }
        } else if (message.kind === 'predictions-csv') {
          set({
            exportedFile: {
              name: `labml-${message.model}-predictions.csv`,
              mime: 'text/csv',
              content: message.csv,
            },
          });
        } else {
          set({ status: 'error', error: message.message, ...initialTraining });
        }
      };
      worker.onerror = () => {
        set({ status: 'error', error: 'worker' });
      };
    }
    worker.postMessage(request);
  }

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

    setTarget(column) {
      set({
        target: column,
        task: null,
        targetUnsupported: null,
        leaks: [],
        ...initialTraining,
      });
      if (column) send({ kind: 'analyze-target', target: column });
    },

    toggleColumn(column) {
      const state = get();
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
        config: { target: state.target, features, seed: TRAIN_SEED, testRatio: TEST_RATIO },
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
      set({ insights: null, whatIf: null, explanation: null });
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
        config: { target: state.target, features, seed: TRAIN_SEED, testRatio: TEST_RATIO },
      });
    },

    cancelTune() {
      if (get().tuneStatus !== 'running') return;
      send({ kind: 'cancel-tune' });
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

    exportModel() {
      const state = get();
      if (state.trainStatus !== 'done' || !state.insights) return;
      send({ kind: 'export-model', model: state.insights.model });
    },

    exportPredictions() {
      const state = get();
      if (state.trainStatus !== 'done' || !state.insights) return;
      send({ kind: 'export-predictions', model: state.insights.model });
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

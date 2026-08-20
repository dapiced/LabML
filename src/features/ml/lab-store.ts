import { create } from 'zustand';
import type {
  ColumnSuggestion,
  DatasetMeta,
  ColumnProfile,
  ExclusionReason,
  TaskInfo,
} from '@/features/ml/data/types';
import type { ModelKey, ModelResult, TrainSummary } from '@/features/ml/train/types';
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
  loadFile: (file: File) => void;
  loadDemo: (fileName: string) => void;
  setTarget: (column: string | null) => void;
  toggleColumn: (column: string) => void;
  train: () => void;
  cancelTrain: () => void;
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
        } else if (message.kind === 'train-cancelled') {
          set({ ...initialTraining });
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

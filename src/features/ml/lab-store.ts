import { create } from 'zustand';
import type {
  ColumnSuggestion,
  DatasetMeta,
  ColumnProfile,
  ExclusionReason,
  TaskInfo,
  WorkerRequest,
  WorkerResponse,
} from '@/features/ml/data/types';

export type LabStatus = 'idle' | 'parsing' | 'ready' | 'error';

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
  loadFile: (file: File) => void;
  loadDemo: (fileName: string) => void;
  setTarget: (column: string | null) => void;
  toggleColumn: (column: string) => void;
  reset: () => void;
}

let worker: Worker | null = null;

function terminateWorker() {
  worker?.terminate();
  worker = null;
}

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
        } else {
          set({ status: 'error', error: message.message });
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
      set({ ...initialData, status: 'parsing', meta: null });
      send({ kind: 'parse-file', file });
    },

    loadDemo(fileName) {
      terminateWorker();
      set({ ...initialData, status: 'parsing' });
      send({ kind: 'parse-url', url: `/datasets/${fileName}`, name: fileName });
    },

    setTarget(column) {
      set({ target: column, task: null, targetUnsupported: null, leaks: [] });
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
      set({ overrides });
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

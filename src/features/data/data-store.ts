import { create } from 'zustand';
import { DEFAULT_RECIPE, parseRecipeFile } from '@/features/data/quality/types';
import type { CleanStats, QualityReport, RecipeOptions } from '@/features/data/quality/types';
import type { DriftReport } from '@/features/data/quality/drift';
import type { JoinStats } from '@/features/data/quality/join';
import type { DatasetMeta } from '@/features/ml/data/types';
import type { DataWorkerRequest, DataWorkerResponse } from '@/features/data/data-protocol';

export type DataStatus = 'idle' | 'parsing' | 'ready' | 'error';

interface ExportedFile {
  name: string;
  mime: string;
  content: string;
}

interface DataState {
  status: DataStatus;
  error: string | null;
  rowsParsed: number;
  meta: DatasetMeta | null;
  /** Report and preview of the ORIGINAL data — the "before" side. */
  report: QualityReport | null;
  preview: Record<string, string>[];
  /** Inferred type per column, the baseline for the type overrides. */
  columnTypes: Record<string, string>;
  /** Provenance of an imported recipe, for the confirmation line. */
  recipeSource: { name: string; exportedAt?: string } | null;
  recipeImportError: boolean;
  options: RecipeOptions;
  /** Report, preview and counters of the cleaned data — the "after" side. */
  cleanedReport: QualityReport | null;
  cleanedPreview: Record<string, string>[];
  stats: CleanStats | null;
  applying: boolean;
  /** File produced by an export action, consumed once by the download effect. */
  exportedFile: ExportedFile | null;
  /** Cleaned CSV handed to the ML Lab, consumed once by the page. */
  labHandoff: { name: string; content: string } | null;
  driftStatus: 'idle' | 'parsing' | 'done';
  driftReport: DriftReport | null;
  compareMeta: DatasetMeta | null;
  joinStatus: 'idle' | 'parsing' | 'ready' | 'done';
  /** Second file parsed and waiting for a key: name, rows, candidate keys. */
  joinCandidate: { name: string; rows: number; candidates: string[] } | null;
  joinStats: JoinStats | null;
  loadJoinFile: (file: File) => void;
  loadJoinDemo: (fileName: string) => void;
  applyJoin: (key: string) => void;
  loadFile: (file: File) => void;
  loadDemo: (fileName: string) => void;
  setOptions: (partial: Partial<RecipeOptions>) => void;
  importRecipe: (file: File) => void;
  loadCompareFile: (file: File) => void;
  loadCompareDemo: (fileName: string) => void;
  exportCsv: () => void;
  exportRecipe: () => void;
  openInLab: () => void;
  clearExportedFile: () => void;
  clearLabHandoff: () => void;
  reset: () => void;
}

let worker: Worker | null = null;

function terminateWorker() {
  worker?.terminate();
  worker = null;
}

const initialData = {
  status: 'idle' as DataStatus,
  error: null,
  rowsParsed: 0,
  meta: null,
  report: null,
  preview: [],
  columnTypes: {},
  recipeSource: null,
  recipeImportError: false,
  options: DEFAULT_RECIPE,
  cleanedReport: null,
  cleanedPreview: [],
  stats: null,
  applying: false,
  exportedFile: null,
  labHandoff: null,
  driftStatus: 'idle' as const,
  driftReport: null,
  compareMeta: null,
  joinStatus: 'idle' as const,
  joinCandidate: null,
  joinStats: null,
};

export const useDataStore = create<DataState>((set, get) => {
  function send(request: DataWorkerRequest) {
    if (!worker) {
      worker = new Worker(new URL('./data.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<DataWorkerResponse>) => {
        const message = event.data;
        if (message.kind === 'progress') {
          set({ rowsParsed: message.rows });
        } else if (message.kind === 'parsed') {
          set({
            status: 'ready',
            meta: message.payload.meta,
            report: message.payload.report,
            preview: message.payload.preview,
            columnTypes: message.payload.columnTypes,
            rowsParsed: message.payload.meta.rowCount,
            applying: true,
          });
          // The recipe preview is live from the start.
          send({ kind: 'apply', options: get().options });
        } else if (message.kind === 'applied') {
          set({
            applying: false,
            cleanedReport: message.payload.report,
            cleanedPreview: message.payload.preview,
            stats: message.payload.stats,
          });
        } else if (message.kind === 'drift') {
          set({ driftStatus: 'done', driftReport: message.payload, compareMeta: message.meta });
        } else if (message.kind === 'join-ready') {
          set({
            joinStatus: 'ready',
            joinCandidate: {
              name: message.name,
              rows: message.rows,
              candidates: message.candidates,
            },
          });
        } else if (message.kind === 'joined') {
          // The joined data IS the dataset now: report, recipe and drift all
          // restart from it — same handler shape as a fresh parse.
          set({
            status: 'ready',
            meta: message.payload.meta,
            report: message.payload.report,
            preview: message.payload.preview,
            columnTypes: message.payload.columnTypes,
            rowsParsed: message.payload.meta.rowCount,
            applying: true,
            joinStatus: 'done',
            joinCandidate: null,
            joinStats: message.stats,
            driftStatus: 'idle',
            driftReport: null,
            compareMeta: null,
          });
          send({ kind: 'apply', options: get().options });
        } else if (message.kind === 'csv') {
          if (message.purpose === 'lab') {
            set({ labHandoff: { name: message.name, content: message.content } });
          } else {
            set({
              exportedFile: { name: message.name, mime: 'text/csv', content: message.content },
            });
          }
        } else {
          set({ status: 'error', error: message.message, applying: false });
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
      set({ ...initialData, options: get().options, status: 'parsing' });
      send({ kind: 'parse-file', file });
    },

    loadDemo(fileName) {
      terminateWorker();
      set({ ...initialData, options: get().options, status: 'parsing' });
      send({ kind: 'parse-url', url: `/datasets/${fileName}`, name: fileName });
    },

    setOptions(partial) {
      const options = { ...get().options, ...partial };
      set({ options, applying: true, recipeImportError: false });
      send({ kind: 'apply', options });
    },

    loadJoinFile(file) {
      if (get().status !== 'ready') return;
      set({ joinStatus: 'parsing', joinCandidate: null, joinStats: null });
      send({ kind: 'parse-join-file', file });
    },

    loadJoinDemo(fileName) {
      if (get().status !== 'ready') return;
      set({ joinStatus: 'parsing', joinCandidate: null, joinStats: null });
      send({ kind: 'parse-join-url', url: `/datasets/${fileName}`, name: fileName });
    },

    applyJoin(key) {
      if (get().joinStatus !== 'ready') return;
      send({ kind: 'apply-join', key });
    },

    loadCompareFile(file) {
      if (get().status !== 'ready') return;
      // A drift compare cancels any join waiting for its key (worker too).
      set({
        driftStatus: 'parsing',
        driftReport: null,
        compareMeta: null,
        joinStatus: 'idle',
        joinCandidate: null,
      });
      send({ kind: 'parse-compare-file', file });
    },

    loadCompareDemo(fileName) {
      if (get().status !== 'ready') return;
      set({
        driftStatus: 'parsing',
        driftReport: null,
        compareMeta: null,
        joinStatus: 'idle',
        joinCandidate: null,
      });
      send({ kind: 'parse-compare-url', url: `/datasets/${fileName}`, name: fileName });
    },

    importRecipe(file) {
      void file.text().then((text) => {
        const parsed = parseRecipeFile(text);
        if (!parsed) {
          set({ recipeImportError: true });
          return;
        }
        set({
          options: parsed.options,
          applying: true,
          recipeImportError: false,
          recipeSource: { name: parsed.source ?? file.name, exportedAt: parsed.exportedAt },
        });
        send({ kind: 'apply', options: parsed.options });
      });
    },

    exportCsv() {
      send({ kind: 'export-csv', purpose: 'download' });
    },

    exportRecipe() {
      const { meta, options, stats } = get();
      if (!meta) return;
      const recipe = {
        tool: 'LabML Data Studio',
        source: meta.name,
        exportedAt: new Date().toISOString(),
        options,
        effect: stats,
      };
      set({
        exportedFile: {
          name: `${meta.name.replace(/\.[a-z]+$/i, '')}-recipe.json`,
          mime: 'application/json',
          content: JSON.stringify(recipe, null, 2),
        },
      });
    },

    openInLab() {
      send({ kind: 'export-csv', purpose: 'lab' });
    },

    clearExportedFile() {
      set({ exportedFile: null });
    },

    clearLabHandoff() {
      set({ labHandoff: null });
    },

    reset() {
      terminateWorker();
      set({ ...initialData });
    },
  };
});

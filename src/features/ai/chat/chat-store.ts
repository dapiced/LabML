import { create } from 'zustand';
import type { QueryResult } from '@/features/ai/chat/engine';
import type { ColumnInfo } from '@/features/ai/chat/parser';
import type {
  AnsweredBy,
  ChatEngine,
  ChatWorkerRequest,
  ChatWorkerResponse,
} from '@/features/ai/chat/chat.worker';
import type { DatasetMeta } from '@/features/ml/data/types';

export type ChatStatus = 'idle' | 'parsing' | 'ready' | 'error';

export interface ChatMessage {
  role: 'user' | 'assistant';
  /** The user's question (role user). */
  text?: string;
  /** Structured answer (role assistant) — rendered localized by the page. */
  result?: QueryResult;
  /** True when neither interpreter could understand the question. */
  unknown?: boolean;
  /**
   * V27: which interpreter produced this query — shown as a badge. V27.1: on
   * a refusal it says nobody understood, never that the model read anything.
   */
  engine?: AnsweredBy;
}

/** V27 local-model lifecycle, all of it visible to the user. */
export type LlmStatus =
  'unknown' | 'unavailable' | 'no-webgpu' | 'offered' | 'loading' | 'ready' | 'failed';

interface ChatState {
  status: ChatStatus;
  error: string | null;
  meta: DatasetMeta | null;
  columns: ColumnInfo[];
  messages: ChatMessage[];
  thinking: boolean;
  llmStatus: LlmStatus;
  /** Bytes the model download costs — announced BEFORE it starts. */
  llmBytes: number;
  llmProgress: { loaded: number; total: number } | null;
  llmError: string | null;
  /** The user's choice of interpreter; deterministic stays the default. */
  engine: ChatEngine;
  loadFile: (file: File) => void;
  loadDemo: (fileName: string) => void;
  ask: (question: string, lang: string) => void;
  probeLlm: () => void;
  enableLlm: () => void;
  setEngine: (engine: ChatEngine) => void;
  reset: () => void;
}

let worker: Worker | null = null;

function terminateWorker() {
  worker?.terminate();
  worker = null;
}

const initialState = {
  status: 'idle' as ChatStatus,
  error: null,
  meta: null,
  columns: [],
  messages: [],
  thinking: false,
  llmStatus: 'unknown' as LlmStatus,
  llmBytes: 0,
  llmProgress: null,
  llmError: null,
  engine: 'deterministic' as ChatEngine,
};

export const useChatStore = create<ChatState>((set, get) => {
  function send(request: ChatWorkerRequest) {
    if (!worker) {
      worker = new Worker(new URL('./chat.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<ChatWorkerResponse>) => {
        const message = event.data;
        if (message.kind === 'ready') {
          set({ status: 'ready', meta: message.meta, columns: message.columns, messages: [] });
        } else if (message.kind === 'answer') {
          set({
            thinking: false,
            messages: [
              ...get().messages,
              { role: 'assistant', result: message.payload, engine: message.engine },
            ],
          });
        } else if (message.kind === 'unknown') {
          set({
            thinking: false,
            messages: [
              ...get().messages,
              { role: 'assistant', unknown: true, engine: message.by },
            ],
          });
        } else if (message.kind === 'llm-capability') {
          set({
            llmBytes: message.totalBytes,
            llmStatus: !message.available
              ? 'unavailable'
              : message.webgpu
                ? 'offered'
                : 'no-webgpu',
          });
        } else if (message.kind === 'llm-progress') {
          set({ llmProgress: { loaded: message.loaded, total: message.total } });
        } else if (message.kind === 'llm-ready') {
          set({ llmStatus: 'ready', llmProgress: null, engine: 'llm' });
        } else if (message.kind === 'llm-failed') {
          set({ llmStatus: 'failed', llmProgress: null, llmError: message.reason });
        } else if (message.kind === 'error') {
          set({ status: 'error', error: message.message, thinking: false });
        }
      };
      worker.onerror = () => {
        set({ status: 'error', error: 'worker' });
      };
    }
    worker.postMessage(request);
  }

  return {
    ...initialState,

    loadFile(file) {
      terminateWorker();
      set({ ...initialState, status: 'parsing' });
      send({ kind: 'parse-file', file });
    },

    loadDemo(fileName) {
      terminateWorker();
      set({ ...initialState, status: 'parsing' });
      send({ kind: 'parse-url', url: `/datasets/${fileName}`, name: fileName });
    },

    ask(question, lang) {
      const trimmed = question.trim();
      if (!trimmed || get().status !== 'ready' || get().thinking) return;
      set({ thinking: true, messages: [...get().messages, { role: 'user', text: trimmed }] });
      send({ kind: 'ask', question: trimmed, lang, engine: get().engine });
    },

    probeLlm() {
      if (get().llmStatus !== 'unknown') return;
      send({ kind: 'llm-probe' });
    },

    enableLlm() {
      const state = get();
      if (state.llmStatus !== 'offered' && state.llmStatus !== 'failed') return;
      set({ llmStatus: 'loading', llmProgress: null, llmError: null });
      send({ kind: 'llm-load' });
    },

    setEngine(engine) {
      // The local model can only be chosen once it is actually loaded.
      if (engine === 'llm' && get().llmStatus !== 'ready') return;
      set({ engine });
    },

    reset() {
      terminateWorker();
      set({ ...initialState });
    },
  };
});

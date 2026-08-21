import { create } from 'zustand';
import type { QueryResult } from '@/features/ai/chat/engine';
import type { ColumnInfo } from '@/features/ai/chat/parser';
import type { ChatWorkerRequest, ChatWorkerResponse } from '@/features/ai/chat/chat.worker';
import type { DatasetMeta } from '@/features/ml/data/types';

export type ChatStatus = 'idle' | 'parsing' | 'ready' | 'error';

export interface ChatMessage {
  role: 'user' | 'assistant';
  /** The user's question (role user). */
  text?: string;
  /** Structured answer (role assistant) — rendered localized by the page. */
  result?: QueryResult;
  /** True when the parser could not understand the question. */
  unknown?: boolean;
}

interface ChatState {
  status: ChatStatus;
  error: string | null;
  meta: DatasetMeta | null;
  columns: ColumnInfo[];
  messages: ChatMessage[];
  thinking: boolean;
  loadFile: (file: File) => void;
  loadDemo: (fileName: string) => void;
  ask: (question: string, lang: string) => void;
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
            messages: [...get().messages, { role: 'assistant', result: message.payload }],
          });
        } else if (message.kind === 'unknown') {
          set({
            thinking: false,
            messages: [...get().messages, { role: 'assistant', unknown: true }],
          });
        } else {
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
      send({ kind: 'ask', question: trimmed, lang });
    },

    reset() {
      terminateWorker();
      set({ ...initialState });
    },
  };
});

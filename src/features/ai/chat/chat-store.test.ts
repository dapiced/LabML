import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatStore } from './chat-store';

/** V47 — a worker that can be made to crash on demand; jsdom has none. */
class FakeWorker {
  static instances: FakeWorker[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage() {}

  terminate() {
    this.terminated = true;
  }
}

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('V47 — a crashed chat worker', () => {
  it('lowers the thinking flag that no answer will ever clear', () => {
    useChatStore.getState().loadDemo('titanic.csv');
    useChatStore.setState({ status: 'ready', llmStatus: 'ready', engine: 'llm' });
    useChatStore.getState().ask('how many rows?', 'en');
    expect(useChatStore.getState().thinking).toBe(true);
    const crashed = FakeWorker.instances[0];

    crashed.onerror?.({} as ErrorEvent);

    const state = useChatStore.getState();
    expect(state.thinking).toBe(false);
    expect(state.status).toBe('error');
    // The model lived in that worker: the page stops offering it as loaded.
    expect(state.llmStatus).toBe('failed');
    expect(state.engine).toBe('deterministic');
    expect(crashed.terminated).toBe(true);
  });
});

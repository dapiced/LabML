import { afterEach, describe, expect, it, vi } from 'vitest';
import { CANCEL_POLL_MS, trainInParallel } from './parallel-run';
import type { TrainConfig } from './types';

/** A helper that accepts its batch and never answers — a heavy family mid-fit. */
class SilentWorker {
  static instances: SilentWorker[] = [];
  terminated = false;
  onmessage: unknown = null;
  onerror: unknown = null;
  onmessageerror: unknown = null;

  constructor() {
    SilentWorker.instances.push(this);
  }

  postMessage() {}

  terminate() {
    this.terminated = true;
  }
}

const config: TrainConfig = { target: 'y', features: ['x'], seed: 42, testRatio: 0.2 };

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  SilentWorker.instances = [];
});

describe('V47 — cancelling during the parallel phase', () => {
  it('stops the helpers instead of waiting for them to finish', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('Worker', SilentWorker);
    vi.stubGlobal('navigator', { hardwareConcurrency: 8 });
    let cancelled = false;

    const run = trainInParallel(
      ['x', 'y'],
      [
        ['1', '2', '3'],
        ['a', 'b', 'a'],
      ],
      config,
      true,
      () => undefined,
      () => cancelled,
    );
    expect(SilentWorker.instances.length).toBeGreaterThan(0);

    cancelled = true;
    await vi.advanceTimersByTimeAsync(CANCEL_POLL_MS);

    // Before V47 this promise never settled while a helper was still fitting.
    await expect(run).resolves.toEqual({ pretrained: new Map(), report: null });
    expect(SilentWorker.instances.every((worker) => worker.terminated)).toBe(true);
  });
});

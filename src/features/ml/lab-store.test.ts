import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isStaleResponse, isTrainingBusy, useLabStore } from './lab-store';
import type { WorkerRequest, WorkerResponse } from './worker-protocol';

/**
 * V47 — the store and its worker, without a real worker. jsdom has no Worker,
 * so a fake records what the store sends and lets the test answer, in any
 * order and at any time — which is exactly what a real worker does.
 */
class FakeWorker {
  static instances: FakeWorker[] = [];
  sent: WorkerRequest[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(request: WorkerRequest) {
    this.sent.push(request);
  }

  terminate() {
    this.terminated = true;
  }

  answer(message: WorkerResponse) {
    this.onmessage?.({ data: message } as MessageEvent<WorkerResponse>);
  }

  crash() {
    this.onerror?.({} as ErrorEvent);
  }
}

const latest = () => FakeWorker.instances[FakeWorker.instances.length - 1];

/** A dataset parsed and a classification target chosen — ready to train. */
function readyToTrain() {
  const store = useLabStore.getState();
  store.loadDemo('iris.csv');
  latest().answer({
    kind: 'parsed',
    payload: {
      meta: { name: 'iris.csv', rowCount: 3, columnCount: 3, bytes: 10 },
      profiles: [
        { name: 'a', type: 'numeric', rowCount: 3, missingCount: 0, cardinality: 3 },
        { name: 'b', type: 'numeric', rowCount: 3, missingCount: 0, cardinality: 3 },
        { name: 'species', type: 'categorical', rowCount: 3, missingCount: 0, cardinality: 2 },
      ],
      preview: [],
      suggestions: [],
    },
  } as unknown as WorkerResponse);
  useLabStore.getState().setTarget('species');
  latest().answer({
    kind: 'target-analyzed',
    payload: { task: { type: 'classification', classes: ['x', 'y'] }, suggestions: [] },
  } as unknown as WorkerResponse);
}

const result = (key: string) =>
  ({ key, ok: true, metrics: { accuracy: 0.9 }, primary: 0.9 }) as unknown as Extract<
    WorkerResponse,
    { kind: 'model-result' }
  >['result'];

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
});

afterEach(() => {
  useLabStore.getState().reset();
  vi.unstubAllGlobals();
});

describe('V47 — the target cannot move under a running computation', () => {
  it('refuses a new target while a run is training', () => {
    readyToTrain();
    useLabStore.getState().train();
    expect(useLabStore.getState().trainStatus).toBe('training');

    useLabStore.getState().setTarget('a');

    expect(useLabStore.getState().target).toBe('species');
    expect(useLabStore.getState().trainStatus).toBe('training');
  });

  it('refuses a feature toggle while a run is training', () => {
    readyToTrain();
    useLabStore.getState().train();

    useLabStore.getState().toggleColumn('a');

    expect(useLabStore.getState().overrides).toEqual({});
  });

  it('never files an old run under a new target', () => {
    // The reproduction: train, then change the target the moment it is done.
    readyToTrain();
    useLabStore.getState().train();
    latest().answer({ kind: 'model-result', result: result('logistic') });
    latest().answer({
      kind: 'train-complete',
      summary: { taskType: 'classification', seed: 42 },
    } as unknown as WorkerResponse);
    expect(useLabStore.getState().trainStatus).toBe('done');

    useLabStore.getState().setTarget('a');
    // Answers to requests sent before the change, still on their way.
    latest().answer({ kind: 'model-result', result: result('forest') });
    latest().answer({
      kind: 'insights',
      payload: { model: 'logistic', importance: [] },
    } as unknown as WorkerResponse);
    latest().answer({ kind: 'uncertainty-result', payload: null });

    const state = useLabStore.getState();
    expect(state.target).toBe('a');
    expect(state.results).toEqual([]);
    expect(state.insights).toBeNull();
    expect(state.currentRun).toBeNull();
  });
});

describe('V47 — a crashed worker does not leave the page spinning', () => {
  it('drops the dead worker and clears every busy flag', () => {
    readyToTrain();
    useLabStore.getState().train();
    const crashed = latest();

    crashed.crash();

    const state = useLabStore.getState();
    expect(state.status).toBe('error');
    expect(state.trainStatus).toBe('idle');
    expect(isTrainingBusy(state)).toBe(false);
    expect(crashed.terminated).toBe(true);

    // The next request goes to a fresh worker, not into the void.
    useLabStore.getState().loadDemo('iris.csv');
    expect(latest()).not.toBe(crashed);
  });
});

describe('isStaleResponse', () => {
  it('accepts the training stream only during a run', () => {
    expect(isStaleResponse('model-result', 'training')).toBe(false);
    expect(isStaleResponse('model-result', 'idle')).toBe(true);
    expect(isStaleResponse('train-complete', 'done')).toBe(true);
  });

  it('accepts run-derived answers only once a run is done', () => {
    expect(isStaleResponse('insights', 'done')).toBe(false);
    expect(isStaleResponse('insights', 'idle')).toBe(true);
    expect(isStaleResponse('tune-complete', 'training')).toBe(true);
  });

  it('never fences what belongs to the dataset or the imported model', () => {
    for (const kind of ['parsed', 'target-analyzed', 'explore-result', 'model-loaded'] as const) {
      expect(isStaleResponse(kind, 'idle')).toBe(false);
      expect(isStaleResponse(kind, 'training')).toBe(false);
    }
  });
});

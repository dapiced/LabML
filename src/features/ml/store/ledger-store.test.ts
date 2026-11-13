import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TRAIN_SEED, useLabStore } from '@/features/ml/lab-store';
import { configKey, fileKey, testSetKey, type LedgerEntry } from '@/features/ml/train/ledger';
import type { WorkerRequest, WorkerResponse } from '@/features/ml/worker-protocol';

/**
 * V60: the store and the ledger. The table is replaced by an array, the
 * worker by a recorder: what is under test is when the store reads the
 * ledger, what it writes there, and which seed it sends.
 */
const table = vi.hoisted(() => ({ entries: [] as LedgerEntry[], fail: false }));

vi.mock('@/features/ml/projects/ledger-db', () => ({
  loadLedger: (file: string) =>
    table.fail
      ? Promise.reject(new Error('no IndexedDB'))
      : Promise.resolve(table.entries.filter((entry) => entry.file === file)),
  recordReading: (entry: LedgerEntry) => {
    if (table.fail) return Promise.reject(new Error('no IndexedDB'));
    const known = table.entries.some(
      (e) => e.testSet === entry.testSet && e.config === entry.config,
    );
    if (!known) table.entries.push(entry);
    return Promise.resolve(table.entries.filter((e) => e.file === entry.file));
  },
}));

// The run table is not under test, and jsdom has no IndexedDB to back it.
vi.mock('@/features/ml/projects/db', () => ({
  db: { runs: { add: () => Promise.resolve(1), update: () => Promise.resolve(1) } },
}));

class FakeWorker {
  static instances: FakeWorker[] = [];
  sent: WorkerRequest[] = [];
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(request: WorkerRequest) {
    this.sent.push(request);
  }
  terminate() {}
  answer(message: WorkerResponse) {
    this.onmessage?.({ data: message } as MessageEvent<WorkerResponse>);
  }
}

const latest = () => FakeWorker.instances[FakeWorker.instances.length - 1];
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const iris = { name: 'iris.csv', rowCount: 150, columnCount: 3 };
const file = fileKey(iris, 'species');

async function ready() {
  useLabStore.getState().loadDemo('iris.csv');
  latest().answer({
    kind: 'parsed',
    payload: {
      meta: { ...iris, bytes: 10 },
      profiles: [
        { name: 'a', type: 'numeric', rowCount: 150, missingCount: 0, cardinality: 30 },
        { name: 'b', type: 'numeric', rowCount: 150, missingCount: 0, cardinality: 30 },
        { name: 'species', type: 'categorical', rowCount: 150, missingCount: 0, cardinality: 2 },
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
  await settle();
}

/** A training that ends, with the columns it used, up to the auto-saved run. */
async function finishRun(featureColumns: string[], seed = useLabStore.getState().seed) {
  useLabStore.getState().train();
  latest().answer({
    kind: 'model-result',
    result: { key: 'logistic', ok: true, metrics: { accuracy: 0.9 }, primary: 0.9 },
  } as unknown as WorkerResponse);
  latest().answer({
    kind: 'train-complete',
    summary: { taskType: 'classification', task: { type: 'classification' }, seed, featureColumns },
  } as unknown as WorkerResponse);
  latest().answer({
    kind: 'insights',
    payload: { model: 'logistic', importance: [] },
  } as unknown as WorkerResponse);
  await settle();
  await settle();
}

const trainRequests = () =>
  latest().sent.filter(
    (request): request is Extract<WorkerRequest, { kind: 'train' }> => request.kind === 'train',
  );

beforeEach(() => {
  FakeWorker.instances = [];
  table.entries = [];
  table.fail = false;
  vi.stubGlobal('Worker', FakeWorker);
});

afterEach(() => {
  useLabStore.getState().reset();
  vi.unstubAllGlobals();
});

describe('V60: the ledger in the store', () => {
  it('starts a file never seen on the default seed, with an empty ledger', async () => {
    await ready();
    expect(useLabStore.getState().seed).toBe(TRAIN_SEED);
    expect(useLabStore.getState().ledgerEntries).toEqual([]);
  });

  it('writes one reading per finished run, and gives the run its count', async () => {
    await ready();
    await finishRun(['a', 'b']);

    expect(table.entries).toHaveLength(1);
    expect(table.entries[0]).toMatchObject({
      file,
      testSet: testSetKey(iris, 'species', 42, null),
      seed: 42,
      config: configKey(['a', 'b'], false),
    });
    const state = useLabStore.getState();
    expect(state.ledgerEntries).toHaveLength(1);
    expect(state.currentRun?.ledger).toEqual({ reads: 1, splits: 1 });
  });

  it('reads nothing new when the same configuration is trained again', async () => {
    await ready();
    await finishRun(['a', 'b']);
    await finishRun(['b', 'a']);
    expect(table.entries).toHaveLength(1);
    expect(useLabStore.getState().currentRun?.ledger).toEqual({ reads: 1, splits: 1 });
  });

  it('counts another set of columns as another reading of the same test set', async () => {
    await ready();
    await finishRun(['a', 'b']);
    await finishRun(['a']);
    expect(table.entries).toHaveLength(2);
    expect(useLabStore.getState().currentRun?.ledger).toEqual({ reads: 2, splits: 1 });
  });

  it('sends the fresh seed to the next training, and starts that split at one', async () => {
    await ready();
    await finishRun(['a', 'b']);
    await finishRun(['a']);

    useLabStore.getState().drawFreshSplit();
    expect(useLabStore.getState().seed).toBe(43);
    expect(useLabStore.getState().trainStatus).toBe('idle');
    expect(useLabStore.getState().currentRun).toBeNull();

    await finishRun(['a'], 43);
    expect(trainRequests().at(-1)?.config.seed).toBe(43);
    expect(useLabStore.getState().currentRun?.ledger).toEqual({ reads: 1, splits: 2 });
  });

  it('resumes a returning user on the split dealt last', async () => {
    table.entries = [
      { file, testSet: testSetKey(iris, 'species', 42, null), seed: 42, config: 'x', at: 1 },
      { file, testSet: testSetKey(iris, 'species', 43, null), seed: 43, config: 'x', at: 2 },
    ];
    await ready();
    expect(useLabStore.getState().seed).toBe(43);
    expect(useLabStore.getState().ledgerEntries).toHaveLength(2);
    useLabStore.getState().train();
    expect(trainRequests().at(-1)?.config.seed).toBe(43);
  });

  it('gives another target its own ledger, back on the default seed', async () => {
    table.entries = [
      { file, testSet: testSetKey(iris, 'species', 43, null), seed: 43, config: 'x', at: 2 },
    ];
    await ready();
    expect(useLabStore.getState().seed).toBe(43);
    useLabStore.getState().setTarget('a');
    await settle();
    expect(useLabStore.getState().seed).toBe(TRAIN_SEED);
    expect(useLabStore.getState().ledgerEntries).toEqual([]);
  });

  it('does not draw while a run is training', async () => {
    await ready();
    useLabStore.getState().train();
    useLabStore.getState().drawFreshSplit();
    expect(useLabStore.getState().seed).toBe(42);
    expect(useLabStore.getState().trainStatus).toBe('training');
  });

  it('leaves the seed alone on a chronological split: the draw would change nothing', async () => {
    await ready();
    useLabStore.getState().setSplitChoice({ mode: 'chronological', column: 'date' });
    useLabStore.getState().drawFreshSplit();
    expect(useLabStore.getState().seed).toBe(42);
  });

  it('trains and saves the run all the same where IndexedDB is missing', async () => {
    table.fail = true;
    await ready();
    await finishRun(['a', 'b']);
    const state = useLabStore.getState();
    expect(state.trainStatus).toBe('done');
    expect(state.currentRun).not.toBeNull();
    expect(state.currentRun?.ledger).toBeUndefined();
    expect(state.ledgerEntries).toEqual([]);
  });
});

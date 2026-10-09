import { describe, expect, it, vi } from 'vitest';
import { createResponseHandlers } from '@/features/ml/store/responses';
import { initialData, type LabState } from '@/features/ml/store/state';
import type { WorkerResponse } from '@/features/ml/worker-protocol';

/**
 * V51 — the dispatch table, one entry at a time. The bodies were moved out of
 * a 250-line `if / else if` chain unchanged; these cases pin, for every answer
 * that only updates state, which fields it writes. A body pasted under the
 * wrong kind fails here.
 */
function harness(state: Partial<LabState> = {}) {
  let current = { ...initialData, ...state } as LabState;
  const set = vi.fn((patch: Partial<LabState> | ((s: LabState) => Partial<LabState>)) => {
    current = { ...current, ...(typeof patch === 'function' ? patch(current) : patch) };
  });
  const attachArtifact = vi.fn();
  const send = vi.fn();
  const handlers = createResponseHandlers({
    set: set as never,
    get: () => current,
    send,
    attachArtifact,
    persistDatasetCsv: vi.fn(async () => undefined),
  });
  const dispatch = (message: WorkerResponse) =>
    (handlers[message.kind] as (response: WorkerResponse) => void)(message);
  return { dispatch, state: () => current, attachArtifact, send };
}

const payload = { marker: true } as never;

const CASES: [string, WorkerResponse, Partial<LabState>][] = [
  ['progress', { kind: 'progress', rows: 5000 }, { rowsParsed: 5000 }],
  [
    'model-start',
    { kind: 'model-start', key: 'tree', index: 2, total: 9 },
    { trainStatus: 'training', modelProgress: { key: 'tree', index: 2, total: 9 } },
  ],
  ['what-if-result', { kind: 'what-if-result', payload }, { whatIf: payload, explanation: null }],
  [
    'tune-progress',
    { kind: 'tune-progress', done: 3, total: 12, bestCv: 0.8 },
    { tuneProgress: { done: 3, total: 12, bestCv: 0.8 } },
  ],
  ['tune-cancelled', { kind: 'tune-cancelled' }, { tuneStatus: 'idle', tuneProgress: null }],
  [
    'curve-progress',
    { kind: 'curve-progress', done: 1, total: 5 },
    { curveProgress: { done: 1, total: 5 } },
  ],
  ['curve-cancelled', { kind: 'curve-cancelled' }, { curveStatus: 'idle', curveProgress: null }],
  [
    'robust-progress',
    { kind: 'robust-progress', done: 4, total: 80 },
    { robustProgress: { done: 4, total: 80 } },
  ],
  [
    'robust-cancelled',
    { kind: 'robust-cancelled' },
    { robustStatus: 'idle', robustProgress: null },
  ],
  [
    'explore-result',
    { kind: 'explore-result', payload },
    { exploreStatus: 'done', exploration: payload },
  ],
  [
    'forecast-result',
    { kind: 'forecast-result', payload },
    { forecastStatus: 'done', forecastPayload: payload },
  ],
  [
    'batch-error',
    { kind: 'batch-error', message: 'missing-columns' },
    { batchStatus: 'error', batchResult: null, batchError: 'missing-columns' },
  ],
  [
    'model-loaded',
    { kind: 'model-loaded', manifest: payload },
    {
      importedManifest: payload,
      importedStatus: 'idle',
      importedResult: null,
      importedError: null,
    },
  ],
  [
    'imported-scored',
    { kind: 'imported-scored', payload },
    { importedResult: payload, importedStatus: 'idle', importedError: null },
  ],
  [
    'import-error',
    { kind: 'import-error', message: 'bad-manifest' },
    { importedError: 'bad-manifest', importedStatus: 'idle' },
  ],
  [
    'error',
    { kind: 'error', message: 'no-features' },
    { status: 'error', error: 'no-features', trainStatus: 'idle' },
  ],
];

describe('worker response table', () => {
  it.each(CASES)('%s writes exactly its own fields', (_kind, message, expected) => {
    const { dispatch, state } = harness({ trainStatus: 'done' });
    dispatch(message);
    expect(state()).toMatchObject(expected);
  });

  it('attaches the late analyses to the run, and only those', () => {
    const { dispatch, attachArtifact } = harness({ trainStatus: 'done' });
    dispatch({ kind: 'explore-result', payload });
    dispatch({ kind: 'forecast-result', payload });
    dispatch({ kind: 'tune-progress', done: 1, total: 2, bestCv: null });
    expect(attachArtifact.mock.calls).toEqual([
      [{ exploration: payload }],
      [{ forecast: payload }],
    ]);
  });
});

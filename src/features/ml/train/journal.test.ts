import { afterEach, describe, expect, it, vi } from 'vitest';
import { profileColumn } from '@/features/ml/data/profile';
import * as ensembleModule from '@/features/ml/train/ensemble';
import {
  createJournal,
  MAX_DETAIL,
  noteText,
  notesField,
  type RunNote,
} from '@/features/ml/train/journal';
import * as models from '@/features/ml/train/models';
import { trainInParallel } from '@/features/ml/train/parallel-run';
import { robustRank } from '@/features/ml/train/robust';
import { runTraining } from '@/features/ml/train/trainer';
import type { Cell } from '@/features/ml/data/types';
import type { TrainConfig } from '@/features/ml/train/types';

// V55: a run that fell back from something says so. Before this wave each of
// the cases below ended in an empty `catch` and left no trace anywhere.

function dataset(n = 240) {
  const x1: Cell[] = [];
  const x2: Cell[] = [];
  const y: Cell[] = [];
  for (let i = 0; i < n; i++) {
    const positive = (i * 7) % 5 < 2;
    x1.push(String(positive ? 10 + (i % 9) : i % 9));
    x2.push(String((i * 3) % 11));
    y.push(positive ? 'yes' : 'no');
  }
  const columns = new Map<string, Cell[]>([
    ['x1', x1],
    ['x2', x2],
    ['y', y],
  ]);
  const profiles = [...columns].map(([name, values]) => profileColumn(name, values));
  return { columns, profiles };
}

const config: TrainConfig = { target: 'y', features: ['x1', 'x2'], seed: 42, testRatio: 0.2 };
const quiet = { onModelStart: () => {}, onModelResult: () => {}, isCancelled: () => false };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the journal itself', () => {
  it('has nothing to say about a run where nothing happened', () => {
    const journal = createJournal();
    expect(journal.notes()).toEqual([]);
    expect(notesField(journal)).toEqual({});
  });

  it('counts a repeated fallback instead of repeating it', () => {
    const journal = createJournal();
    journal.add('fold-failed', 'gbdt', new Error('boom'));
    journal.add('fold-failed', 'gbdt', new Error('boom again'));
    journal.add('fold-failed', 'forest');
    expect(journal.notes()).toEqual([
      { code: 'fold-failed', model: 'gbdt', detail: 'boom', count: 2 },
      { code: 'fold-failed', model: 'forest' },
    ]);
  });

  it('is bounded, in length and in width', () => {
    const journal = createJournal(2);
    journal.add('ensemble-failed', undefined, 'x'.repeat(1000));
    journal.add('helper-failed');
    journal.add('helper-unavailable');
    const notes = journal.notes();
    expect(notes).toHaveLength(2);
    expect(notes[0].detail).toHaveLength(MAX_DETAIL);
  });

  it('flattens a multi-line cause and drops an empty one', () => {
    const journal = createJournal();
    journal.add('helper-failed', undefined, 'line one\n   line two');
    journal.add('ensemble-failed', undefined, '   ');
    expect(journal.notes()[0].detail).toBe('line one line two');
    expect(journal.notes()[1].detail).toBeUndefined();
  });

  it('hands out copies: a reader cannot rewrite the record', () => {
    const journal = createJournal();
    journal.add('helper-failed');
    journal.notes()[0].code = 'fold-failed';
    expect(journal.notes()[0].code).toBe('helper-failed');
  });

  it('writes a note as a sentence, with its cause when there is one', () => {
    const t = (key: string, options?: Record<string, unknown>) =>
      key.startsWith('ml.lab.models.')
        ? key.slice('ml.lab.models.'.length)
        : `${key}|${String(options?.model)}|${String(options?.count)}`;
    const note: RunNote = { code: 'fold-failed', model: 'gbdt', detail: 'boom', count: 3 };
    expect(noteText(note, t)).toBe('ml.lab.journal.fold-failed|gbdt|3 (boom)');
    expect(noteText({ code: 'ensemble-failed' }, t)).toBe('ml.lab.journal.ensemble-failed||1');
  });
});

describe('a run that fell back says so (V55)', () => {
  it('adds no key to the summary of a run where nothing failed', async () => {
    const { columns, profiles } = dataset();
    const outcome = await runTraining(columns, profiles, config, quiet);
    expect(outcome!.summary.ensemble).toBeDefined();
    expect('notes' in outcome!.summary).toBe(false);
  });

  it('records an ensemble that could not be built, and keeps the families', async () => {
    vi.spyOn(ensembleModule, 'buildEnsemble').mockImplementation(() => {
      throw new Error('ensemble exploded');
    });
    const { columns, profiles } = dataset();
    const outcome = await runTraining(columns, profiles, config, quiet);
    expect(outcome!.summary.notes).toEqual([
      { code: 'ensemble-failed', detail: 'ensemble exploded' },
    ]);
    expect(outcome!.artifacts.models.has('ensemble')).toBe(false);
    expect(outcome!.artifacts.models.has('gbdt')).toBe(true);
  });

  it('records the folds a family failed in the robust ranking', async () => {
    const zoo = models.modelZoo('classification');
    const failing = zoo.map((def) =>
      def.key === 'knn'
        ? {
            ...def,
            train: () => {
              throw new Error('knn refused this fold');
            },
          }
        : def,
    );
    vi.spyOn(models, 'modelZoo').mockReturnValue(failing);
    const { columns, profiles } = dataset();
    const result = await robustRank(
      columns,
      profiles,
      config,
      { onProgress: () => {}, isCancelled: () => false },
      2,
    );
    expect(result!.notes).toEqual([
      { code: 'fold-failed', model: 'knn', detail: 'knn refused this fold', count: 4 },
    ]);
    // The family that failed every fold is absent; the others are ranked.
    expect(result!.entries.some((entry) => entry.model === 'knn')).toBe(false);
    expect(result!.entries.length).toBeGreaterThan(1);
  });

  it('adds no key to a robust ranking where every fold was fitted', async () => {
    const { columns, profiles } = dataset();
    const result = await robustRank(
      columns,
      profiles,
      config,
      { onProgress: () => {}, isCancelled: () => false },
      1,
    );
    expect('notes' in result!).toBe(false);
  });
});

describe('the parallel phase says when it gave up (V55)', () => {
  const header = ['x', 'y'];
  const cells: Cell[][] = [
    ['1', '2', '3'],
    ['a', 'b', 'a'],
  ];

  it('records a helper that could not be started', async () => {
    class NoWorker {
      constructor() {
        throw new Error('workers are blocked here');
      }
    }
    vi.stubGlobal('Worker', NoWorker);
    vi.stubGlobal('navigator', { hardwareConcurrency: 8 });
    const journal = createJournal();
    const run = await trainInParallel(
      header,
      cells,
      config,
      true,
      () => undefined,
      () => false,
      journal,
    );
    expect(run.pretrained.size).toBe(0);
    expect(journal.notes()[0]).toMatchObject({
      code: 'helper-unavailable',
      detail: 'workers are blocked here',
    });
  });

  it('records a helper that crashed mid-batch', async () => {
    class CrashingWorker {
      onmessage: unknown = null;
      onerror: ((event: { message: string }) => void) | null = null;
      onmessageerror: unknown = null;
      postMessage() {
        queueMicrotask(() => this.onerror?.({ message: 'helper out of memory' }));
      }
      terminate() {}
    }
    vi.stubGlobal('Worker', CrashingWorker);
    vi.stubGlobal('navigator', { hardwareConcurrency: 8 });
    const journal = createJournal();
    await trainInParallel(
      header,
      cells,
      config,
      true,
      () => undefined,
      () => false,
      journal,
    );
    expect(journal.notes()[0]).toMatchObject({
      code: 'helper-failed',
      detail: 'helper out of memory',
    });
  });

  it('records a model that came back and could not be rebuilt', async () => {
    class GarbageWorker {
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onerror: unknown = null;
      onmessageerror: unknown = null;
      postMessage(request: { families: string[] }) {
        queueMicrotask(() => {
          this.onmessage?.({
            data: {
              kind: 'family-done',
              outcome: {
                key: request.families[0],
                ok: true,
                serialized: { kind: 'no-such-kind', json: '{}' },
              },
            },
          });
          this.onmessage?.({ data: { kind: 'batch-done' } });
        });
      }
      terminate() {}
    }
    vi.stubGlobal('Worker', GarbageWorker);
    vi.stubGlobal('navigator', { hardwareConcurrency: 8 });
    const journal = createJournal();
    const run = await trainInParallel(
      header,
      cells,
      config,
      true,
      () => undefined,
      () => false,
      journal,
    );
    expect(run.pretrained.size).toBe(0);
    expect(journal.notes().map((note) => note.code)).toContain('helper-rebuild-failed');
  });
});

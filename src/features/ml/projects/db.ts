import Dexie, { type EntityTable } from 'dexie';
import type { StoredDataset } from '@/features/ml/projects/dataset-storage';
import type { RunRecord } from '@/features/ml/projects/types';
import type { LedgerEntry } from '@/features/ml/train/ledger';

/** Local-only run history and saved datasets — IndexedDB never leaves the browser. */
export const db = new Dexie('labml') as Dexie & {
  runs: EntityTable<RunRecord, 'id'>;
  datasets: EntityTable<StoredDataset, 'id'>;
  ledger: EntityTable<LedgerEntry, 'id'>;
};

db.version(1).stores({
  runs: '++id, createdAt, [dataset.name+target]',
});

db.version(2).stores({
  runs: '++id, createdAt, [dataset.name+target]',
  datasets: '++id, savedAt, name',
});

// V60: which configurations each test set has already scored. A table of its
// own, not a count over `runs`: deleting a run from the history does not
// un-read the test set.
db.version(3).stores({
  runs: '++id, createdAt, [dataset.name+target]',
  datasets: '++id, savedAt, name',
  ledger: '++id, file',
});

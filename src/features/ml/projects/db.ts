import Dexie, { type EntityTable } from 'dexie';
import type { StoredDataset } from '@/features/ml/projects/dataset-storage';
import type { RunRecord } from '@/features/ml/projects/types';

/** Local-only run history and saved datasets — IndexedDB never leaves the browser. */
export const db = new Dexie('labml') as Dexie & {
  runs: EntityTable<RunRecord, 'id'>;
  datasets: EntityTable<StoredDataset, 'id'>;
};

db.version(1).stores({
  runs: '++id, createdAt, [dataset.name+target]',
});

db.version(2).stores({
  runs: '++id, createdAt, [dataset.name+target]',
  datasets: '++id, savedAt, name',
});

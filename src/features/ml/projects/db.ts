import Dexie, { type EntityTable } from 'dexie';
import type { RunRecord } from '@/features/ml/projects/types';

/** Local-only run history — IndexedDB never leaves the browser. */
export const db = new Dexie('labml') as Dexie & {
  runs: EntityTable<RunRecord, 'id'>;
};

db.version(1).stores({
  runs: '++id, createdAt, [dataset.name+target]',
});

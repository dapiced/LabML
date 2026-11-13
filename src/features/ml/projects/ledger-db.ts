/**
 * V60: the ledger's table. Everything that decides is in `train/ledger.ts`;
 * this file only reads and writes IndexedDB, loaded on demand like the rest
 * of Dexie so `/ml` renders without it.
 */
import { alreadyRead, type LedgerEntry } from '@/features/ml/train/ledger';

/** Every entry of one file and target, all its splits together. */
export async function loadLedger(file: string): Promise<LedgerEntry[]> {
  const { db } = await import('@/features/ml/projects/db');
  return db.ledger.where('file').equals(file).toArray();
}

/**
 * Writes one reading unless this configuration was already scored on this
 * test set, and returns the entries of the file as they now stand.
 */
export async function recordReading(entry: Omit<LedgerEntry, 'id'>): Promise<LedgerEntry[]> {
  const { db } = await import('@/features/ml/projects/db');
  const entries = await db.ledger.where('file').equals(entry.file).toArray();
  if (alreadyRead(entries, entry.testSet, entry.config)) return entries;
  const id = await db.ledger.add(entry);
  return [...entries, { ...entry, id }];
}

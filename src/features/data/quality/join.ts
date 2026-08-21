/**
 * Left join of a second file onto the loaded dataset, on one shared key
 * column — the everyday enrichment gesture. Matching is exact after trimming
 * (no case folding: a messy key is a finding, not something to paper over).
 * Deterministic: when the right file repeats a key, the FIRST occurrence wins
 * and the duplicates are counted.
 */
import { isMissing } from '@/features/ml/data/infer';
import type { Cell } from '@/features/ml/data/types';

const ORPHAN_SAMPLE = 6;

export interface JoinStats {
  key: string;
  otherName: string;
  /** Main rows that found a right-side match. */
  matchedRows: number;
  /** Main rows left without a match (their new columns stay empty). */
  orphanRows: number;
  /** Distinct unmatched key values, capped for display. */
  orphanKeys: string[];
  /** Right-side keys that appear more than once (first occurrence wins). */
  duplicateKeys: number;
  /** Right rows whose key never matched any main row. */
  unusedRightRows: number;
  addedColumns: string[];
}

export interface JoinResult {
  header: string[];
  columns: Cell[][];
  stats: JoinStats;
}

function keyOf(value: Cell): string | null {
  return isMissing(value) ? null : (value as string).trim();
}

export function joinDatasets(
  mainHeader: string[],
  mainColumns: Cell[][],
  rightHeader: string[],
  rightColumns: Cell[][],
  key: string,
  otherName: string,
): JoinResult {
  const mainAt = mainHeader.indexOf(key);
  const rightAt = rightHeader.indexOf(key);
  if (mainAt < 0 || rightAt < 0) throw new Error('join-key-missing');

  // First occurrence of each right key wins; duplicates are counted.
  const rightIndex = new Map<string, number>();
  let duplicateKeys = 0;
  const rightRows = rightColumns[0]?.length ?? 0;
  for (let r = 0; r < rightRows; r++) {
    const value = keyOf(rightColumns[rightAt][r]);
    if (value === null) continue;
    if (rightIndex.has(value)) duplicateKeys += 1;
    else rightIndex.set(value, r);
  }

  // Added columns: everything from the right except the key, collisions
  // renamed with a numeric suffix so both sides survive.
  const taken = new Set(mainHeader);
  const added: { name: string; sourceAt: number }[] = [];
  for (let c = 0; c < rightHeader.length; c++) {
    if (c === rightAt) continue;
    let name = rightHeader[c];
    let suffix = 2;
    while (taken.has(name)) name = `${rightHeader[c]}_${suffix++}`;
    taken.add(name);
    added.push({ name, sourceAt: c });
  }

  const mainRows = mainColumns[0]?.length ?? 0;
  const newColumns: Cell[][] = added.map(() => new Array<Cell>(mainRows).fill(null));
  let matchedRows = 0;
  const orphanKeySet = new Set<string>();
  const usedRightRows = new Set<number>();
  for (let r = 0; r < mainRows; r++) {
    const value = keyOf(mainColumns[mainAt][r]);
    const at = value === null ? undefined : rightIndex.get(value);
    if (at === undefined) {
      if (value !== null) orphanKeySet.add(value);
      continue;
    }
    matchedRows += 1;
    usedRightRows.add(at);
    for (let c = 0; c < added.length; c++) {
      newColumns[c][r] = rightColumns[added[c].sourceAt][at];
    }
  }

  let unusedRightRows = 0;
  for (const at of rightIndex.values()) {
    if (!usedRightRows.has(at)) unusedRightRows += 1;
  }

  return {
    header: [...mainHeader, ...added.map((entry) => entry.name)],
    columns: [...mainColumns, ...newColumns],
    stats: {
      key,
      otherName,
      matchedRows,
      orphanRows: mainRows - matchedRows,
      orphanKeys: [...orphanKeySet].sort().slice(0, ORPHAN_SAMPLE),
      duplicateKeys,
      unusedRightRows,
      addedColumns: added.map((entry) => entry.name),
    },
  };
}

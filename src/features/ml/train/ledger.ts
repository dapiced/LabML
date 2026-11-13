/**
 * V60: the test-set ledger.
 *
 * A test set measures a model only as long as nobody chooses with it. Inside
 * one run the lab already keeps that rule: validation chooses, test measures
 * (V35, V53). Across runs nothing kept it. Train, read the test score, drop a
 * column, train again, keep the better of the two: the test set has just
 * chosen, and the score that survives is the luckier one.
 *
 * Measured before building, on the three demos, eight to ten splits each. A
 * user who tries configurations (columns toggled) and keeps the best test
 * score sees a score above what the same configuration gets on the other
 * splits. In units of "the noise", the standard deviation of one
 * configuration's test score from one split to the next (2.1 accuracy points
 * on titanic, 1.2 on fraud, 0.33 mpg of RMSE on mpg):
 *
 *   runs compared   titanic   fraud   mpg
 *        2            0.4      0.3    0.1
 *        3            0.6      0.4    0.2
 *        5            0.8      0.6    0.2
 *        7            0.9      0.7    0.3
 *       10            1.05     0.8    0.4
 *
 * In points: +1.7 accuracy points on titanic at 5 runs and +2.2 at 10, +0.8
 * and +1.0 on fraud. A greedy user (keep a change when the test score rises)
 * and a user picking at random give the same curve on fraud and mpg.
 *
 * Titanic is the worst because its configurations are truly equivalent: their
 * real scores sit within 1.5 points of each other, so the best of them is the
 * luckiest and nothing else. On mpg some columns matter (RMSE from 2.6 to
 * 3.9), the comparison finds a real difference, and the luck weighs less.
 *
 * The worst case of the textbook, K independent readings, puts the inflation
 * at sqrt(2 ln K) times the noise: 1.8 at K = 5. Runs scored on the same rows
 * are far from independent, so the measure is two to seven times lower, and
 * it is the measure that sets the two marks below.
 *
 * The ledger counts DISTINCT configurations per test set. Training is
 * deterministic: the same columns on the same split give the same numbers,
 * and reading a number twice chooses nothing.
 *
 * Pure functions only. The table lives in `projects/ledger-db.ts`.
 */
import type { SplitChoice } from '@/features/ml/train/types';
import { fingerprint } from '@/lib/fingerprint';

/**
 * From this many distinct runs, the best test score seen carries a visible
 * share of luck: 0.2 to 0.8 of the split-to-split noise on the demos.
 */
export const WORN_AT = 5;

/**
 * From this many, the luck in the best score reaches the noise itself on the
 * worst demo (0.4 to 1.05): comparing runs on this test set no longer tells a
 * better configuration from a luckier one.
 */
export const SPENT_AT = 10;

export interface DatasetIdentity {
  name: string;
  rowCount: number;
  columnCount: number;
}

/** One distinct configuration scored on one test set. Holds no data and no column name. */
export interface LedgerEntry {
  id?: number;
  /** The file and the target: every split of it shares this key. */
  file: string;
  /** The exact test set: file, target and how the rows were dealt. */
  testSet: string;
  seed: number;
  /** Fingerprint of the configuration, see `configKey`. */
  config: string;
  at: number;
}

export type LedgerLevel = 'first' | 'reused' | 'worn' | 'spent';

export interface LedgerReading {
  /** Distinct configurations this test set has scored, the current one included. */
  reads: number;
  /** How many test sets this file and target have been dealt, this one included. */
  splits: number;
  level: LedgerLevel;
}

/**
 * A file is recognised by its name and its shape. Two different files with
 * the same name, row count and column count would share a ledger: the lab
 * keeps no fingerprint of the content, and says so in its limits.
 */
export function fileKey(dataset: DatasetIdentity, target: string): string {
  return [dataset.name, dataset.rowCount, dataset.columnCount, target].join('\u001f');
}

/**
 * A chronological split has one test set whatever the seed: the newest rows.
 * The two others are dealt by the seed.
 */
export function seedDealsTheTest(split: SplitChoice | null): boolean {
  return split?.mode !== 'chronological';
}

export function testSetKey(
  dataset: DatasetIdentity,
  target: string,
  seed: number,
  split: SplitChoice | null,
): string {
  const dealt = split ? `${split.mode}:${split.column}` : 'random';
  const parts = [fileKey(dataset, target), dealt];
  if (seedDealsTheTest(split)) parts.push(String(seed));
  return parts.join('\u001f');
}

/** What makes two runs on the same test set different: the columns and the weighting. */
export function configKey(features: readonly string[], classWeighting: boolean): string {
  const columns = [...features].sort().join('\u001f');
  return fingerprint(`${classWeighting ? 'w' : '-'}\u001e${columns}`);
}

export function levelOf(reads: number): LedgerLevel {
  if (reads >= SPENT_AT) return 'spent';
  if (reads >= WORN_AT) return 'worn';
  if (reads >= 2) return 'reused';
  return 'first';
}

/**
 * Reads the ledger of one file and target for one test set. `pending` is a
 * configuration about to be scored, or just scored and not yet written: it
 * counts once, whether or not the entries already hold it.
 */
export function readLedger(
  entries: readonly LedgerEntry[],
  testSet: string,
  pending?: string,
): LedgerReading {
  const configs = new Set<string>();
  const testSets = new Set<string>([testSet]);
  for (const entry of entries) {
    testSets.add(entry.testSet);
    if (entry.testSet === testSet) configs.add(entry.config);
  }
  if (pending !== undefined) configs.add(pending);
  const reads = configs.size;
  return { reads, splits: testSets.size, level: levelOf(reads) };
}

/** True when this configuration was already scored on this test set. */
export function alreadyRead(
  entries: readonly LedgerEntry[],
  testSet: string,
  config: string,
): boolean {
  return entries.some((entry) => entry.testSet === testSet && entry.config === config);
}

/** The split a returning user resumes on: the last one dealt for this file and target. */
export function latestSeed(entries: readonly LedgerEntry[], fallback: number): number {
  let latest: LedgerEntry | null = null;
  for (const entry of entries) {
    if (latest === null || entry.at > latest.at) latest = entry;
  }
  return latest ? latest.seed : fallback;
}

/** A seed no test set of this file and target was dealt with. */
export function freshSeed(entries: readonly LedgerEntry[], current: number): number {
  let highest = current;
  for (const entry of entries) highest = Math.max(highest, entry.seed);
  return highest + 1;
}

/**
 * What a stored run says of its ledger, for the views, the report and the
 * model card: the count as it stood when the run was scored, and the warning
 * once that count reached the first mark.
 */
export function ledgerLines(
  ledger: { reads: number; splits: number } | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): string[] {
  if (!ledger) return [];
  const lines = [t('ml.lab.ledger.runLine', { count: ledger.reads, splits: ledger.splits })];
  if (ledger.reads >= WORN_AT) lines.push(t('ml.lab.ledger.runWorn'));
  return lines;
}

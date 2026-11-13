import { describe, expect, it } from 'vitest';
import {
  alreadyRead,
  configKey,
  fileKey,
  freshSeed,
  latestSeed,
  ledgerLines,
  levelOf,
  readLedger,
  seedDealsTheTest,
  SPENT_AT,
  testSetKey,
  WORN_AT,
  type LedgerEntry,
} from '@/features/ml/train/ledger';

// V60: a test set is spent a little every time it arbitrates between two
// runs. These tests freeze what counts as a reading, and what does not.

const titanic = { name: 'titanic.csv', rowCount: 891, columnCount: 15 };
const file = fileKey(titanic, 'survived');
const split42 = testSetKey(titanic, 'survived', 42, null);
const split43 = testSetKey(titanic, 'survived', 43, null);

const entry = (testSet: string, config: string, seed = 42, at = 1): LedgerEntry => ({
  file,
  testSet,
  seed,
  config,
  at,
});

describe('what identifies a test set', () => {
  it('changes with the file, its shape, the target, the seed and the way rows are dealt', () => {
    const keys = new Set([
      split42,
      split43,
      testSetKey(titanic, 'pclass', 42, null),
      testSetKey({ ...titanic, rowCount: 890 }, 'survived', 42, null),
      testSetKey({ ...titanic, name: 'other.csv' }, 'survived', 42, null),
      testSetKey(titanic, 'survived', 42, { mode: 'group', column: 'ticket' }),
      testSetKey(titanic, 'survived', 42, { mode: 'chronological', column: 'date' }),
    ]);
    expect(keys.size).toBe(7);
  });

  it('gives a chronological split one test set whatever the seed', () => {
    const dated = { mode: 'chronological' as const, column: 'date' };
    expect(testSetKey(titanic, 'survived', 42, dated)).toBe(
      testSetKey(titanic, 'survived', 43, dated),
    );
    expect(seedDealsTheTest(dated)).toBe(false);
    expect(seedDealsTheTest({ mode: 'group', column: 'ticket' })).toBe(true);
    expect(seedDealsTheTest(null)).toBe(true);
  });

  it('keeps every split of a file under the same file key', () => {
    expect(split42.startsWith(file)).toBe(true);
    expect(split43.startsWith(file)).toBe(true);
  });
});

describe('what identifies a configuration', () => {
  it('ignores the order of the columns', () => {
    expect(configKey(['age', 'sex', 'fare'], false)).toBe(configKey(['fare', 'age', 'sex'], false));
  });

  it('changes with a column added, a column removed, and the class weighting', () => {
    const base = configKey(['age', 'sex'], false);
    expect(configKey(['age', 'sex', 'fare'], false)).not.toBe(base);
    expect(configKey(['age'], false)).not.toBe(base);
    expect(configKey(['age', 'sex'], true)).not.toBe(base);
  });

  it('names no column: the ledger stores a fingerprint, not the schema', () => {
    const key = configKey(['salary', 'diagnosis'], false);
    expect(key).toMatch(/^[0-9a-f]{8}$/);
    expect(key).not.toContain('salary');
  });
});

describe('readLedger', () => {
  it('counts nothing on a test set no run has scored', () => {
    expect(readLedger([], split42)).toEqual({ reads: 0, splits: 1, level: 'first' });
  });

  it('counts distinct configurations, not trainings', () => {
    const entries = [entry(split42, 'a'), entry(split42, 'b'), entry(split42, 'a')];
    expect(readLedger(entries, split42).reads).toBe(2);
  });

  it('counts a pending configuration once, written or not', () => {
    const entries = [entry(split42, 'a')];
    expect(readLedger(entries, split42, 'a').reads).toBe(1);
    expect(readLedger(entries, split42, 'b').reads).toBe(2);
  });

  it('keeps each split its own count, and counts the splits dealt', () => {
    const entries = [
      entry(split42, 'a'),
      entry(split42, 'b'),
      entry(split42, 'c'),
      entry(split43, 'a', 43),
    ];
    expect(readLedger(entries, split42)).toMatchObject({ reads: 3, splits: 2 });
    expect(readLedger(entries, split43)).toMatchObject({ reads: 1, splits: 2 });
    // A split not dealt yet is one more split, with nothing read.
    expect(readLedger(entries, testSetKey(titanic, 'survived', 44, null))).toMatchObject({
      reads: 0,
      splits: 3,
    });
  });
});

describe('the two marks', () => {
  it('are the measured ones', () => {
    expect(WORN_AT).toBe(5);
    expect(SPENT_AT).toBe(10);
  });

  it('name four states', () => {
    expect(levelOf(1)).toBe('first');
    expect(levelOf(2)).toBe('reused');
    expect(levelOf(WORN_AT - 1)).toBe('reused');
    expect(levelOf(WORN_AT)).toBe('worn');
    expect(levelOf(SPENT_AT - 1)).toBe('worn');
    expect(levelOf(SPENT_AT)).toBe('spent');
  });
});

describe('alreadyRead', () => {
  it('is true only for the same configuration on the same test set', () => {
    const entries = [entry(split42, 'a')];
    expect(alreadyRead(entries, split42, 'a')).toBe(true);
    expect(alreadyRead(entries, split42, 'b')).toBe(false);
    expect(alreadyRead(entries, split43, 'a')).toBe(false);
  });
});

describe('the seed', () => {
  it('resumes on the split dealt last, and on the default when the ledger is empty', () => {
    expect(latestSeed([], 42)).toBe(42);
    const entries = [entry(split42, 'a', 42, 10), entry(split43, 'a', 43, 30)];
    expect(latestSeed(entries, 42)).toBe(43);
    // The user went back to the first split afterwards: that is the last one dealt.
    expect(latestSeed([...entries, entry(split42, 'b', 42, 40)], 42)).toBe(42);
  });

  it('draws a seed no split of this file was dealt with', () => {
    expect(freshSeed([], 42)).toBe(43);
    const entries = [entry(split42, 'a', 42), entry(split43, 'a', 43)];
    expect(freshSeed(entries, 42)).toBe(44);
    expect(freshSeed(entries, 43)).toBe(44);
  });
});

describe('ledgerLines', () => {
  const t = (key: string, options?: Record<string, unknown>) =>
    `${key} ${JSON.stringify(options ?? {})}`;

  it('says nothing of a run stored before the ledger', () => {
    expect(ledgerLines(undefined, t)).toEqual([]);
  });

  it('gives the count, and the warning from the first mark', () => {
    expect(ledgerLines({ reads: 3, splits: 1 }, t)).toEqual([
      'ml.lab.ledger.runLine {"count":3,"splits":1}',
    ]);
    expect(ledgerLines({ reads: WORN_AT, splits: 2 }, t)).toEqual([
      `ml.lab.ledger.runLine {"count":${WORN_AT},"splits":2}`,
      'ml.lab.ledger.runWorn {}',
    ]);
  });
});

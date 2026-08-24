import { describe, expect, it } from 'vitest';
import { readHeader } from './header';

describe('readHeader — an ordinary file pays nothing', () => {
  it('leaves distinct names exactly as they are', () => {
    const read = readHeader(['age', 'city', 'salary']);
    expect(read.names).toEqual(['age', 'city', 'salary']);
    expect(read.issues).toEqual([]);
  });

  it('trims surrounding whitespace', () => {
    expect(readHeader([' age ', '\tcity']).names).toEqual(['age', 'city']);
  });

  it('reads an empty row as no columns', () => {
    expect(readHeader([])).toEqual({ names: [], issues: [] });
  });
});

/**
 * The defect this module exists for. Measured before the fix on
 * `age,age\n10,999\n20,888`: `header.indexOf('age')` resolved to column 0 and
 * `new Map(header.map(…)).get('age')` to column 1 — the same name, two
 * different columns, in the same worker.
 */
describe('readHeader — one name can only mean one column', () => {
  it('suffixes a repeated name and keeps the first occurrence intact', () => {
    const read = readHeader(['age', 'age']);
    expect(read.names).toEqual(['age', 'age (2)']);
    expect(read.issues).toEqual([
      { kind: 'duplicate', index: 1, original: 'age', name: 'age (2)' },
    ]);
  });

  it('keeps climbing for a third and fourth', () => {
    expect(readHeader(['age', 'age', 'age', 'age']).names).toEqual([
      'age',
      'age (2)',
      'age (3)',
      'age (4)',
    ]);
  });

  it('steps over a suffix the file already uses', () => {
    // Naively appending « (2) » would collide with the column already called
    // that, and re-create the very bug this is fixing.
    expect(readHeader(['age', 'age (2)', 'age']).names).toEqual(['age', 'age (2)', 'age (3)']);
  });

  it('treats names differing only by whitespace as the same name', () => {
    expect(readHeader(['age', ' age']).names).toEqual(['age', 'age (2)']);
  });

  it.each([
    [['age', 'age']],
    [['a', 'a', 'b', 'b']],
    [['x', 'x (2)', 'x', '', 'column_4']],
    [['', '', '']],
    [['n', 'N']],
  ])('never returns two identical names for %j', (row) => {
    const { names } = readHeader(row);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toHaveLength(row.length);
    expect(names.every((name) => name !== '')).toBe(true);
  });

  it('makes indexOf and a name→column map agree', () => {
    // The two lookups that disagreed. Both now land on the same column for
    // every name, which is the property the whole module is for.
    const columns = [
      ['10', '20'],
      ['999', '888'],
    ];
    const { names } = readHeader(['age', 'age']);
    const map = new Map(names.map((name, i) => [name, columns[i]]));
    for (const name of names) {
      expect(map.get(name)).toBe(columns[names.indexOf(name)]);
    }
  });
});

describe('readHeader — a generated name never steals a real one', () => {
  it('names a blank column after its position', () => {
    const read = readHeader(['a', '', 'c']);
    expect(read.names).toEqual(['a', 'column_2', 'c']);
    expect(read.issues).toEqual([{ kind: 'unnamed', index: 1, original: '', name: 'column_2' }]);
  });

  it('yields to a real column that already carries that name', () => {
    // Measured before the fix: `a,,column_2` → ["a","column_2","column_2"].
    // The blank column moves; the column the file actually named does not.
    const read = readHeader(['a', '', 'column_2']);
    expect(read.names).toEqual(['a', 'column_2 (2)', 'column_2']);
    expect(read.issues).toEqual([
      { kind: 'unnamed', index: 1, original: '', name: 'column_2 (2)' },
    ]);
  });

  it('yields even when the real column comes first', () => {
    expect(readHeader(['column_2', '']).names).toEqual(['column_2', 'column_2 (2)']);
  });

  it('handles a header made entirely of blanks', () => {
    const read = readHeader(['', '', '']);
    expect(read.names).toEqual(['column_1', 'column_2', 'column_3']);
    expect(read.issues.map((issue) => issue.kind)).toEqual(['unnamed', 'unnamed', 'unnamed']);
  });
});

import Papa from 'papaparse';
import { describe, expect, it } from 'vitest';
import { countParseErrors, isRaggedRow, papaConfig, sniffText } from './read';
import { isNonDefault, type ReadFormat } from './locale';

/** Parses a string exactly as both workers do, and reports what Papa said. */
const parse = (text: string) => {
  const sniffed = sniffText(text);
  return Papa.parse<string[]>(text, papaConfig(sniffed.delimiter));
};

/**
 * V35 wave 4. Before this, both workers passed `results.errors` straight to the
 * floor. Measured on `a,b\n"oops,2\n3,4\n5,6`: Papa raised `MissingQuotes`,
 * LabML ignored it, three data rows became one cell, and the UI announced
 * « 1 row » with nothing to suggest the file had not been read whole.
 */
describe('countParseErrors — a quote the file never closes', () => {
  it('counts the row an unterminated quote swallowed', () => {
    const parsed = parse('a,b\n"oops,2\n3,4\n5,6');
    expect(parsed.errors.some((error) => error.code === 'MissingQuotes')).toBe(true);
    expect(countParseErrors(parsed.errors)).toBe(1);
    // The damage the count is there to announce: 3 data rows arrived as 1.
    expect(parsed.data).toHaveLength(2);
  });

  it('counts one broken row once even when it raises two codes', () => {
    const parsed = parse('a,b\n1,"deux"trois\n3,4');
    expect(parsed.errors.map((error) => error.code).sort()).toEqual([
      'InvalidQuotes',
      'MissingQuotes',
    ]);
    expect(countParseErrors(parsed.errors)).toBe(1);
  });

  it('counts nothing on a clean file', () => {
    expect(countParseErrors(parse('a,b\n1,2\n3,4').errors)).toBe(0);
  });

  it('ignores codes that are not about a row', () => {
    // `UndetectableDelimiter` is about the sniff, not about a broken row, and
    // fires on ordinary single-column files.
    expect(countParseErrors([{ code: 'UndetectableDelimiter', row: 0 }])).toBe(0);
  });
});

/**
 * The other half, which Papa does NOT report: rows that parse cleanly and are
 * simply the wrong width. Measured before the fix — `a,b\n1,2,3,4\n5,6` gave
 * `errors: aucune`, and cells 3 and 4 were dropped without a word.
 */
describe('isRaggedRow — a row that is the wrong width', () => {
  it('sees nothing to report in a well-formed row', () => {
    expect(isRaggedRow(['1', '2'], 2)).toBe(false);
  });

  it('flags a row with extra cells, which ingestion drops', () => {
    const parsed = parse('a,b\n1,2,3,4\n5,6');
    expect(parsed.errors).toHaveLength(0);
    expect(isRaggedRow(parsed.data[1], 2)).toBe(true);
    expect(isRaggedRow(parsed.data[2], 2)).toBe(false);
  });

  it('flags a row with missing cells, which ingestion fills with null', () => {
    expect(isRaggedRow(['1'], 3)).toBe(true);
  });

  it('does not flag a blank line, which ingestion skips', () => {
    expect(isRaggedRow([''], 3)).toBe(false);
    expect(isRaggedRow(['   '], 3)).toBe(false);
  });
});

describe('isNonDefault — the notice appears when there is something to say', () => {
  const plain: ReadFormat = {
    encoding: { encoding: 'utf-8', utf8Failed: false, hadBom: false },
    delimiter: ',',
    decimalColumns: [],
  };

  it('stays silent on an ordinary file', () => {
    expect(isNonDefault(plain)).toBe(false);
  });

  it('speaks up when a column had to be renamed', () => {
    expect(
      isNonDefault({
        ...plain,
        headerIssues: [{ kind: 'duplicate', index: 1, original: 'age', name: 'age (2)' }],
      }),
    ).toBe(true);
  });

  it('speaks up when rows were malformed', () => {
    expect(isNonDefault({ ...plain, malformedRows: 1 })).toBe(true);
  });

  it('stays silent on a ReadFormat written before these fields existed', () => {
    // The fields are optional so a persisted V38 run still loads.
    expect(isNonDefault({ ...plain, headerIssues: [], malformedRows: 0 })).toBe(false);
  });
});

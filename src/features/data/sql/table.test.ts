import { describe, expect, it } from 'vitest';
import {
  formatCell,
  NULL_CELL,
  readerFor,
  tableNameFor,
  tableToCsv,
  toSqlTable,
} from '@/features/data/sql/table';

describe('formatCell', () => {
  it('keeps NULL visibly different from an empty string', () => {
    expect(formatCell(null)).toBe(NULL_CELL);
    expect(formatCell(undefined)).toBe(NULL_CELL);
    expect(formatCell('')).toBe('');
  });

  it('renders the types Arrow actually hands back', () => {
    // A COUNT(*) over a large table comes back as BigInt — String() on it is
    // fine, JSON.stringify would throw.
    expect(formatCell(9007199254740993n)).toBe('9007199254740993');
    expect(formatCell(42)).toBe('42');
    expect(formatCell(3.5)).toBe('3.5');
    expect(formatCell(true)).toBe('true');
    expect(formatCell(new Date('2026-08-22T17:00:00Z'))).toBe('2026-08-22T17:00:00.000Z');
    expect(formatCell(new Uint8Array([1, 255]))).toBe('0x01ff');
  });

  it('survives a struct holding a BigInt', () => {
    expect(formatCell({ n: 1n, s: 'x' })).toBe('{"n":"1","s":"x"}');
  });
});

describe('toSqlTable', () => {
  const records = [
    { city: 'Paris', n: 3n },
    { city: 'Lyon', n: 2n },
    { city: null, n: 1n },
  ];

  it('projects the columns in order and marks the truncation', () => {
    expect(toSqlTable(['city', 'n'], records, 2)).toEqual({
      columns: ['city', 'n'],
      rows: [
        ['Paris', '3'],
        ['Lyon', '2'],
      ],
      totalRows: 3,
      truncated: true,
    });
  });

  it('reports the full count even when nothing is cut', () => {
    const table = toSqlTable(['city', 'n'], records, 10);
    expect(table.truncated).toBe(false);
    expect(table.totalRows).toBe(3);
    expect(table.rows[2]).toEqual([NULL_CELL, '1']);
  });
});

describe('tableToCsv', () => {
  it('quotes what needs quoting', () => {
    const table = toSqlTable(['a', 'b'], [{ a: 'x,y', b: 'he said "hi"' }], 10);
    expect(tableToCsv(table)).toBe('a,b\n"x,y","he said ""hi"""');
  });
});

describe('readerFor', () => {
  it('picks a reader per extension and refuses the unknown ones', () => {
    expect(readerFor('cafe-sales.csv')).toBe('read_csv_auto');
    expect(readerFor('SALES.Parquet')).toBe('read_parquet');
    expect(readerFor('events.ndjson')).toBe('read_json_auto');
    // Guessing here would read a binary as text and return garbage rows.
    expect(readerFor('archive.zip')).toBeNull();
  });
});

describe('tableNameFor', () => {
  it('makes a usable SQL identifier', () => {
    expect(tableNameFor('cafe-sales.csv')).toBe('cafe_sales');
    expect(tableNameFor('2024 report.parquet')).toBe('t_2024_report');
    expect(tableNameFor('.csv')).toBe('dropped');
  });
});

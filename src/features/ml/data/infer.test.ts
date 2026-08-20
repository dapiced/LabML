import { describe, expect, it } from 'vitest';
import { inferColumnType, isMissing, parseNumber } from '@/features/ml/data/infer';

describe('isMissing', () => {
  it('treats empty strings, null and NA tokens as missing', () => {
    for (const value of [null, '', '  ', 'NA', 'n/a', 'null', 'NaN', '-', '?']) {
      expect(isMissing(value)).toBe(true);
    }
  });

  it('keeps real values', () => {
    for (const value of ['0', 'false', 'yes', 'abc', '3.14']) {
      expect(isMissing(value)).toBe(false);
    }
  });
});

describe('parseNumber', () => {
  it('parses integers, floats and scientific notation', () => {
    expect(parseNumber('42')).toBe(42);
    expect(parseNumber(' -3.5 ')).toBe(-3.5);
    expect(parseNumber('1e3')).toBe(1000);
  });

  it('rejects non-numeric strings', () => {
    expect(parseNumber('abc')).toBeNull();
    expect(parseNumber('12abc')).toBeNull();
    expect(parseNumber('')).toBeNull();
  });
});

describe('inferColumnType', () => {
  it('detects numeric columns despite missing values', () => {
    expect(inferColumnType('fare', ['7.25', '71.28', null, '8.05', 'NA'])).toBe('numeric');
  });

  it('detects boolean columns', () => {
    expect(inferColumnType('alone', ['True', 'False', 'True', 'False'])).toBe('boolean');
    expect(inferColumnType('ok', ['yes', 'no', 'yes'])).toBe('boolean');
  });

  it('detects ISO and slash dates', () => {
    expect(inferColumnType('day', ['2026-01-01', '2026-01-02', '2026-02-03'])).toBe('date');
    expect(inferColumnType('day', ['01/02/2026', '15/03/2026', '31/12/2025'])).toBe('date');
  });

  it('detects categorical strings with low cardinality', () => {
    const values = Array.from({ length: 300 }, (_, i) => ['red', 'green', 'blue'][i % 3]);
    expect(inferColumnType('color', values)).toBe('categorical');
  });

  it('detects free text with high cardinality', () => {
    const values = Array.from({ length: 300 }, (_, i) => `some free text number ${i}`);
    expect(inferColumnType('comment', values)).toBe('text');
  });

  it('detects id columns by name and uniqueness', () => {
    const values = Array.from({ length: 300 }, (_, i) => String(i + 1));
    expect(inferColumnType('customer_id', values)).toBe('id');
    // Same values under a non-id name stay numeric.
    expect(inferColumnType('quantity', values)).toBe('numeric');
  });

  it('detects uuid columns without an id-like name', () => {
    const values = Array.from(
      { length: 50 },
      (_, i) => `123e4567-e89b-42d3-a456-4266141740${String(i % 100).padStart(2, '0')}`,
    );
    expect(inferColumnType('ref', values)).toBe('id');
  });
});

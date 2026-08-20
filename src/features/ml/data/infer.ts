import type { Cell, ColumnType } from '@/features/ml/data/types';

/** Tokens treated as missing values, compared lowercased and trimmed. */
const MISSING_TOKENS = new Set(['', 'na', 'n/a', 'null', 'nan', 'none', '-', '?']);

const BOOLEAN_TOKENS = new Set([
  'true',
  'false',
  'yes',
  'no',
  'y',
  'n',
  'vrai',
  'faux',
  'oui',
  'non',
]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const SLASH_DATE = /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_LIKE_NAME = /(^|[_\s-])id$|^id([_\s-]|$)|identifier|^uuid$|^guid$/i;

/** How many non-missing values are sampled to infer a column's type. */
const SAMPLE_SIZE = 2000;
/** Share of sampled values that must match for numeric/date inference. */
const MATCH_RATIO = 0.95;

export function isMissing(raw: Cell | undefined): boolean {
  if (raw == null) return true;
  return MISSING_TOKENS.has(raw.trim().toLowerCase());
}

/** Parses a cell into a finite number, or null when it is not numeric. */
export function parseNumber(raw: string): number | null {
  const cleaned = raw.trim();
  if (cleaned === '') return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function sampleNonMissing(values: Cell[]): string[] {
  const sample: string[] = [];
  const step = Math.max(1, Math.floor(values.length / SAMPLE_SIZE));
  for (let i = 0; i < values.length && sample.length < SAMPLE_SIZE; i += step) {
    const value = values[i];
    if (!isMissing(value)) sample.push((value as string).trim());
  }
  return sample;
}

export function inferColumnType(name: string, values: Cell[]): ColumnType {
  const sample = sampleNonMissing(values);
  if (sample.length === 0) return 'text';

  const lowered = sample.map((v) => v.toLowerCase());
  if (lowered.every((v) => BOOLEAN_TOKENS.has(v))) return 'boolean';

  const numericCount = sample.reduce((acc, v) => acc + (parseNumber(v) === null ? 0 : 1), 0);
  if (numericCount / sample.length >= MATCH_RATIO) {
    const distinct = new Set(sample);
    const allIntegers = sample.every((v) => {
      const parsed = parseNumber(v);
      return parsed === null || Number.isInteger(parsed);
    });
    const uniqueRatio = distinct.size / sample.length;
    if (allIntegers && uniqueRatio >= 0.99 && ID_LIKE_NAME.test(name)) return 'id';
    return 'numeric';
  }

  const dateCount = sample.reduce(
    (acc, v) => acc + (ISO_DATE.test(v) || SLASH_DATE.test(v) ? 1 : 0),
    0,
  );
  if (dateCount / sample.length >= MATCH_RATIO) return 'date';

  const distinct = new Set(lowered);
  const uniqueRatio = distinct.size / sample.length;
  if (sample.every((v) => UUID.test(v))) return 'id';
  if (uniqueRatio >= 0.99 && ID_LIKE_NAME.test(name)) return 'id';
  if (distinct.size <= Math.max(20, sample.length * 0.05)) return 'categorical';
  return 'text';
}

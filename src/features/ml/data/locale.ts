/**
 * V38: reading the file exactly as it was written.
 *
 * The defect this module fixes was measured before it was written. Same 900
 * rows, same three numeric columns, same seed — only the way a number is
 * spelled changes:
 *
 * | written    | inferred types | features encoded | champion |
 * | ---------- | -------------- | ---------------- | -------- |
 * | `12.5`     | numeric × 3    | 3                | 1.000    |
 * | `12,5`     | text × 3       | 103              | 0.819    |
 *
 * The baseline scores 0.594, so the headroom above it collapses from 0.406 to
 * 0.225: **45% of the achievable gain, lost in silence**. Nothing warned,
 * nothing refused — `parseNumber` ends in `Number(cleaned)`, `Number('12,5')`
 * is `NaN`, the column falls through to text, and V24's TF-IDF happily
 * tokenises digits into 103 word features.
 *
 * Two rules shape everything here:
 *
 * 1. **Decide by evidence, never by locale guessing.** The browser's language
 *    says nothing about the file someone dragged in. Every decision below is
 *    a count over the actual values, and the count is what gets announced.
 * 2. **Never touch a column the evidence does not cover.** A text column that
 *    happens to contain "Bonjour, 12" must come out untouched. Normalisation
 *    applies to a column only when nearly all of its values are numbers in the
 *    detected format AND the column would otherwise not be numeric at all.
 */
import type { HeaderIssue } from '@/features/ml/data/header';

/** Share of a column's values that must match before it is reformatted. */
export const DECIMAL_CONFIDENCE = 0.9;
/** Below this many usable values a column is too small to judge. */
export const MIN_VALUES_TO_JUDGE = 5;
/** Rows shown in the pre-load preview. */
export const PREVIEW_ROWS = 5;

export type Encoding = 'utf-8' | 'windows-1252';
export type DecimalSeparator = '.' | ',';

export interface EncodingChoice {
  encoding: Encoding;
  /**
   * True when UTF-8 decoding actually failed on these bytes, so the fallback
   * is a certainty rather than a preference. `TextDecoder(…, {fatal: true})`
   * throws on windows-1252 accents — measured, not assumed.
   */
  utf8Failed: boolean;
  /** A byte-order mark settled it; nothing was inferred. */
  hadBom: boolean;
}

/**
 * Decodes bytes, choosing the encoding by trying and failing rather than by
 * sniffing. UTF-8 is attempted in fatal mode: if the bytes are not valid
 * UTF-8, the decoder throws and windows-1252 takes over — the encoding that
 * French Excel writes, and the one whose accented bytes are exactly what
 * makes UTF-8 throw.
 */
export function decodeBytes(
  bytes: Uint8Array,
  forced?: Encoding,
): {
  text: string;
  choice: EncodingChoice;
} {
  const hadBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const body = hadBom ? bytes.subarray(3) : bytes;
  if (forced !== undefined) {
    return {
      text: new TextDecoder(forced).decode(body),
      choice: { encoding: forced, utf8Failed: false, hadBom },
    };
  }
  if (hadBom) {
    return {
      text: new TextDecoder('utf-8').decode(body),
      choice: { encoding: 'utf-8', utf8Failed: false, hadBom: true },
    };
  }
  try {
    return {
      text: new TextDecoder('utf-8', { fatal: true }).decode(body),
      choice: { encoding: 'utf-8', utf8Failed: false, hadBom: false },
    };
  } catch {
    return {
      text: new TextDecoder('windows-1252').decode(body),
      choice: { encoding: 'windows-1252', utf8Failed: true, hadBom: false },
    };
  }
}

/** Delimiters worth considering; Papa guesses too, but never announces it. */
const DELIMITERS = [',', ';', '\t', '|'] as const;
export type Delimiter = (typeof DELIMITERS)[number];

/**
 * The delimiter is the candidate that splits the first lines into the most
 * columns, consistently. A French Excel export uses `;` precisely because the
 * comma is already taken by the decimal separator — so guessing the delimiter
 * and guessing the decimal separator are the same question asked twice.
 */
export function detectDelimiter(text: string): { delimiter: Delimiter; columns: number } {
  const lines = text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .slice(0, 20);
  if (lines.length === 0) return { delimiter: ',', columns: 1 };

  let best: { delimiter: Delimiter; columns: number } = { delimiter: ',', columns: 1 };
  for (const delimiter of DELIMITERS) {
    const counts = lines.map((line) => splitOutsideQuotes(line, delimiter).length);
    const first = counts[0];
    if (first < 2) continue;
    // Consistency matters more than size: a stray comma inside quoted prose
    // can beat the real delimiter on one line but never on all of them.
    const consistent = counts.every((count) => count === first);
    if (consistent && first > best.columns) best = { delimiter, columns: first };
  }
  return best;
}

/** Splits a line on a delimiter, ignoring delimiters inside double quotes. */
function splitOutsideQuotes(line: string, delimiter: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      quoted = !quoted;
      current += char;
    } else if (char === delimiter && !quoted) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

/**
 * A number written the French way: optional sign, digits grouped by spaces
 * (including the narrow no-break space Excel emits) or dots, a comma, then
 * decimals. `1 234,56`, `-0,75`, `12,5`. Deliberately strict — this pattern
 * decides whether real data gets rewritten.
 */
const FRENCH_NUMBER = /^[+-]?\d{1,3}(?:[ \u00a0\u202f.]\d{3})*(?:,\d+)?$|^[+-]?\d+(?:,\d+)?$/;
/** The same shape with the roles swapped: `1,234.56`, `12.5`. */
const ENGLISH_NUMBER = /^[+-]?\d{1,3}(?:[ \u00a0\u202f,]\d{3})*(?:\.\d+)?$|^[+-]?\d+(?:\.\d+)?$/;

export interface ColumnFormat {
  column: string;
  decimal: DecimalSeparator;
  /** How many values proved it — this is what the UI announces. */
  matched: number;
  /** How many non-missing values the column had. */
  total: number;
  /** True when the values carry grouping separators (`1 234,56`). */
  grouped: boolean;
}

function isMissingCell(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === '';
}

/**
 * Decides whether a column is written in a format the app currently misreads,
 * and returns the evidence. Returns null when the column is already readable
 * (plain numbers, or genuine text) — a column is only ever rewritten when
 * doing nothing would definitely lose it.
 */
export function detectColumnFormat(
  column: string,
  values: readonly (string | null)[],
): ColumnFormat | null {
  let total = 0;
  let french = 0;
  let english = 0;
  let grouped = false;
  for (const raw of values) {
    if (isMissingCell(raw)) continue;
    total++;
    const value = (raw as string).trim();
    if (ENGLISH_NUMBER.test(value)) {
      english++;
      continue;
    }
    if (FRENCH_NUMBER.test(value)) {
      french++;
      if (/[ \u00a0\u202f.]/.test(value)) grouped = true;
    }
  }
  if (total < MIN_VALUES_TO_JUDGE) return null;
  // Already readable as written: leave it entirely alone.
  if (english / total >= DECIMAL_CONFIDENCE) return null;
  if (french / total < DECIMAL_CONFIDENCE) return null;
  // A column of bare integers matches both patterns and needs no rewriting;
  // it only counts as French if at least one value actually uses a comma.
  if (!values.some((raw) => !isMissingCell(raw) && (raw as string).includes(','))) return null;
  return { column, decimal: ',', matched: french, total, grouped };
}

/**
 * Rewrites one value from the detected format into the canonical one the rest
 * of the pipeline already understands. Values that do not match the pattern
 * are returned untouched — a stray label inside a numeric column stays a
 * stray label rather than becoming a silently wrong number.
 */
export function normalizeNumber(raw: string): string {
  const value = raw.trim();
  if (!FRENCH_NUMBER.test(value)) return raw;
  return value.replace(/[ \u00a0\u202f.]/g, '').replace(',', '.');
}

export interface ReadFormat {
  encoding: EncodingChoice;
  delimiter: Delimiter;
  /** Columns rewritten from the French form, with the evidence for each. */
  decimalColumns: ColumnFormat[];
  /**
   * V35 wave 4 — columns whose name LabML had to change to keep names unique.
   * Optional so a `ReadFormat` persisted by an earlier version still loads.
   */
  headerIssues?: HeaderIssue[];
  /**
   * V35 wave 4 — rows the file did not deliver as declared: a quote it never
   * closed, or a line with the wrong number of cells. Counted rather than
   * guessed at, and stated, because the alternative is dropping data in
   * silence. See `countRaggedRows` and `countParseErrors`.
   */
  malformedRows?: number;
}

/** True when the file was NOT plain UTF-8 with dot decimals and commas. */
export function isNonDefault(format: ReadFormat): boolean {
  return (
    format.encoding.encoding !== 'utf-8' ||
    format.delimiter !== ',' ||
    format.decimalColumns.length > 0 ||
    (format.headerIssues?.length ?? 0) > 0 ||
    (format.malformedRows ?? 0) > 0
  );
}

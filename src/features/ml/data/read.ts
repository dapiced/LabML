/**
 * V38: the one place a CSV becomes rows, for both the ML Lab and the Data
 * Studio. Before this module each worker called `Papa.parse(file, {
 * skipEmptyLines: true })` and nothing else — no encoding, no delimiter, no
 * decimal separator — so a French export lost its numeric columns in silence.
 *
 * The shape of the fix is dictated by a constraint we must not break: V25's
 * streaming abort. The ML worker reads a file in chunks so it can stop the
 * moment the 20M-cell budget is blown, and slurping the whole file into an
 * ArrayBuffer to inspect it would throw that away. So detection reads only the
 * HEAD of the file, and the streaming parse continues exactly as before —
 * with the encoding and delimiter it just learned.
 *
 * Decimal normalisation then happens after ingestion, on whole columns, where
 * the evidence for a column is actually available. See `locale.ts` for why a
 * column is only ever rewritten when leaving it alone would definitely lose it.
 */
import Papa from 'papaparse';
import {
  decodeBytes,
  detectColumnFormat,
  detectDelimiter,
  normalizeNumber,
  type ColumnFormat,
  type Delimiter,
  type Encoding,
  type ReadFormat,
} from '@/features/ml/data/locale';
import type { Cell } from '@/features/ml/data/types';

/**
 * Bytes read to decide encoding and delimiter. Large enough to cover a header
 * plus a few hundred rows of real data, small enough that a 2 GB file costs
 * nothing to inspect.
 */
export const SNIFF_BYTES = 256 * 1024;

/** What the user explicitly chose, when they overrode the detection. */
export interface ReadOverrides {
  encoding?: Encoding;
  delimiter?: Delimiter;
  /** Turn the decimal rewrite off entirely, whatever the evidence says. */
  decimal?: 'auto' | 'off';
}

/**
 * Looks at the head of a file and decides how to read it. Reads bytes, not
 * text: the encoding question cannot be answered after the browser has already
 * decoded (and mangled) the file.
 */
export async function sniffFile(
  file: Blob,
  overrides?: ReadOverrides,
): Promise<{ encoding: ReturnType<typeof decodeBytes>['choice']; delimiter: Delimiter }> {
  const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
  const { text, choice } = decodeBytes(head, overrides?.encoding);
  return {
    encoding: choice,
    delimiter: overrides?.delimiter ?? detectDelimiter(text).delimiter,
  };
}

/** The same decision for text we already hold (pasted, generated, or SQL). */
export function sniffText(
  text: string,
  overrides?: ReadOverrides,
): {
  encoding: ReturnType<typeof decodeBytes>['choice'];
  delimiter: Delimiter;
} {
  return {
    encoding: { encoding: overrides?.encoding ?? 'utf-8', utf8Failed: false, hadBom: false },
    delimiter: overrides?.delimiter ?? detectDelimiter(text).delimiter,
  };
}

/**
 * Rewrites the columns written in the French form into the canonical one, IN
 * PLACE, and returns what was changed so the caller can announce it. A column
 * the evidence does not cover is not touched at all.
 */
export function applyDecimalFormats(
  header: readonly string[],
  columns: Cell[][],
  overrides?: ReadOverrides,
): ColumnFormat[] {
  if (overrides?.decimal === 'off') return [];
  const applied: ColumnFormat[] = [];
  for (let i = 0; i < header.length; i++) {
    const format = detectColumnFormat(header[i], columns[i] as (string | null)[]);
    if (format === null) continue;
    const values = columns[i];
    for (let r = 0; r < values.length; r++) {
      const raw = values[r];
      if (typeof raw === 'string') values[r] = normalizeNumber(raw);
    }
    applied.push(format);
  }
  return applied;
}

/**
 * Papa's options for a parse that respects what we detected. `encoding` is
 * only meaningful for File inputs — Papa passes it to `FileReader.readAsText`
 * — and is harmless on a string, which is already decoded.
 */
export function papaConfig(delimiter: Delimiter, encoding?: Encoding): Papa.ParseConfig {
  return {
    skipEmptyLines: true,
    delimiter,
    ...(encoding !== undefined && { encoding }),
  };
}

/** Everything the UI needs to state how the file was read. */
export function buildReadFormat(
  sniffed: { encoding: ReturnType<typeof decodeBytes>['choice']; delimiter: Delimiter },
  decimalColumns: ColumnFormat[],
): ReadFormat {
  return {
    encoding: sniffed.encoding,
    delimiter: sniffed.delimiter,
    decimalColumns,
  };
}

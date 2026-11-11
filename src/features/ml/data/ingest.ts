/**
 * V54: the one place a file becomes a table, for the ML Lab, the Data Studio
 * and the chat.
 *
 * V38 unified how a CSV is READ (`read.ts`: encoding, delimiter, decimals).
 * What stayed copied in each worker was the loop that KEEPS the rows, and the
 * copies drifted: the V25 memory guard lived in the ML Lab worker only, so the
 * same file was refused by name in one section and left to exhaust the tab in
 * the two others; the chat worker skipped the encoding, delimiter and decimal
 * detection; a drift or join file had its delimiter detected and its decimals
 * left alone. Measured on the unguarded loop (Node, 11 columns, 2 GiB heap):
 * 1.1 GiB at 20M cells, out of memory between 50M and 60M.
 *
 * Every caller now gets the same table or the same named refusal:
 *  - `too-large:<rows>:<columns>` when rows × columns passes the budget; the
 *    file stream is aborted at that row, nothing is kept;
 *  - `empty` when there is no header or no data row.
 */
import Papa from 'papaparse';
import { readHeader, type HeaderIssue } from '@/features/ml/data/header';
import { MAX_CELLS } from '@/features/ml/data/limits';
import type { ReadFormat } from '@/features/ml/data/locale';
import {
  applyDecimalFormats,
  buildReadFormat,
  countParseErrors,
  isRaggedRow,
  papaConfig,
  sniffFile,
  sniffText,
} from '@/features/ml/data/read';
import type { Cell } from '@/features/ml/data/types';

const PROGRESS_EVERY = 5000;

export interface IngestOptions {
  /** Cell budget (rows × columns). Defaults to the lab's `MAX_CELLS`. */
  maxCells?: number;
  /** Called every 5 000 rows kept, with the running count. */
  onProgress?: (rows: number) => void;
}

/** A file read into columns, with the record of how it was read. */
export interface Table {
  header: string[];
  columns: Cell[][];
  rowCount: number;
  readFormat: ReadFormat;
}

/**
 * The row loop itself, exposed for the tests: header first, then rows, with
 * the budget checked BEFORE a row is kept.
 */
export class Ingestion {
  header: string[] = [];
  columns: Cell[][] = [];
  rowCount = 0;
  headerIssues: HeaderIssue[] = [];
  /** Rows the file did not deliver as declared: counted, never guessed. */
  malformedRows = 0;
  overflowed = false;
  private readonly maxCells: number;
  private readonly onProgress: ((rows: number) => void) | undefined;

  constructor(options: IngestOptions = {}) {
    this.maxCells = options.maxCells ?? MAX_CELLS;
    this.onProgress = options.onProgress;
  }

  /** Returns false once the budget is blown: the caller stops the stream. */
  push(rows: readonly string[][]): boolean {
    if (this.overflowed) return false;
    for (const row of rows) {
      if (this.header.length === 0) {
        // Unique by construction, and every rename reported (V35 wave 4).
        const read = readHeader(row);
        this.header = read.names;
        this.headerIssues = read.issues;
        this.columns = this.header.map(() => []);
        continue;
      }
      // A fully empty line is skipped, not counted.
      if (row.length === 1 && row[0].trim() === '') continue;
      // A row of the wrong width still loads (extra cells dropped, missing
      // ones null) but it is counted so the UI can say it happened.
      if (isRaggedRow(row, this.header.length)) this.malformedRows += 1;
      if ((this.rowCount + 1) * this.header.length > this.maxCells) {
        this.overflowed = true;
        return false;
      }
      for (let i = 0; i < this.header.length; i++) {
        this.columns[i].push(row[i] ?? null);
      }
      this.rowCount += 1;
      if (this.rowCount % PROGRESS_EVERY === 0) this.onProgress?.(this.rowCount);
    }
    return true;
  }

  /** Papa's own row errors (an unterminated quote swallows rows silently). */
  addParseErrors(errors: readonly { code: string; row?: number }[]): void {
    this.malformedRows += countParseErrors(errors);
  }
}

export function isSpreadsheet(name: string): boolean {
  return /\.(xlsx|xls)$/i.test(name);
}

/** Excel support: SheetJS is loaded lazily, the first sheet becomes CSV. */
export async function spreadsheetToCsv(file: Blob): Promise<string> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!firstSheet) throw new Error('empty');
  return XLSX.utils.sheet_to_csv(firstSheet);
}

type Sniffed = Awaited<ReturnType<typeof sniffFile>>;

function finish(ingestion: Ingestion, sniffed: Sniffed): Table {
  const { header, columns, rowCount } = ingestion;
  if (ingestion.overflowed) throw new Error(`too-large:${rowCount}:${header.length}`);
  if (header.length === 0 || rowCount === 0) throw new Error('empty');
  // Whole columns, after ingestion: the evidence for a column only exists
  // once all of its values are in hand (V38).
  const readFormat = buildReadFormat(sniffed, applyDecimalFormats(header, columns), {
    headerIssues: ingestion.headerIssues,
    malformedRows: ingestion.malformedRows,
  });
  return { header, columns, rowCount, readFormat };
}

function readText(text: string, options: IngestOptions): Table {
  const ingestion = new Ingestion(options);
  const sniffed = sniffText(text);
  const results = Papa.parse<string[]>(text, papaConfig(sniffed.delimiter));
  ingestion.addParseErrors(results.errors);
  ingestion.push(results.data);
  return finish(ingestion, sniffed);
}

/**
 * Reads a CSV/TSV file, a spreadsheet, or text already in hand. A file is
 * streamed in chunks so the read stops at the row that blows the budget (V25):
 * a 2 GB file costs the budget, not its size.
 */
export async function readTable(
  source: File | string,
  options: IngestOptions = {},
): Promise<Table> {
  if (typeof source === 'string') return readText(source, options);
  if (isSpreadsheet(source.name)) return readText(await spreadsheetToCsv(source), options);

  // Only the head of the file is read as bytes to decide how to read the rest.
  const sniffed = await sniffFile(source);
  const ingestion = new Ingestion(options);
  await new Promise<void>((resolve, reject) => {
    Papa.parse<string[]>(source, {
      ...papaConfig(sniffed.delimiter, sniffed.encoding.encoding),
      chunk: (results, parser) => {
        ingestion.addParseErrors(results.errors);
        if (!ingestion.push(results.data)) parser.abort();
      },
      complete: () => resolve(),
      error: (error) => reject(new Error(error.message)),
    });
  });
  return finish(ingestion, sniffed);
}

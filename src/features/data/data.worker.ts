/// <reference lib="webworker" />
/**
 * The Data Studio worker: the file is parsed and cleaned here and the original
 * dataset never leaves this worker — the UI only receives the quality report,
 * a short preview and counters. Same privacy contract as the ML Lab worker.
 */
import Papa from 'papaparse';
import { buildQualityReport } from '@/features/data/quality/checks';
import { inferColumnType } from '@/features/ml/data/infer';
import { applyRecipe } from '@/features/data/quality/clean';
import { DEFAULT_RECIPE } from '@/features/data/quality/types';
import type { Cell } from '@/features/ml/data/types';
import type { DataWorkerRequest, DataWorkerResponse } from '@/features/data/data-protocol';

const PREVIEW_ROWS = 8;
const PROGRESS_EVERY = 5000;

let sourceName = '';
let header: string[] = [];
let columns: Cell[][] = [];
let rowCount = 0;
// Cleaning always restarts from the pristine columns, so toggles never compound.
let cleanedHeader: string[] = [];
let cleanedColumns: Cell[][] = [];

function post(message: DataWorkerResponse) {
  self.postMessage(message);
}

function ingestRows(rows: string[][]) {
  for (const row of rows) {
    if (header.length === 0) {
      header = row.map((cell, i) => (cell.trim() === '' ? `column_${i + 1}` : cell.trim()));
      columns = header.map(() => []);
      continue;
    }
    if (row.length === 1 && row[0].trim() === '') continue;
    for (let i = 0; i < header.length; i++) {
      columns[i].push(row[i] ?? null);
    }
    rowCount += 1;
    if (rowCount % PROGRESS_EVERY === 0) post({ kind: 'progress', rows: rowCount });
  }
}

function previewOf(head: string[], cols: Cell[][]): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  const total = cols[0]?.length ?? 0;
  for (let r = 0; r < Math.min(PREVIEW_ROWS, total); r++) {
    const row: Record<string, string> = {};
    for (let c = 0; c < head.length; c++) {
      row[head[c]] = cols[c][r] ?? '';
    }
    rows.push(row);
  }
  return rows;
}

function resetState() {
  sourceName = '';
  header = [];
  columns = [];
  rowCount = 0;
  cleanedHeader = [];
  cleanedColumns = [];
}

function finishParse(name: string, bytes: number) {
  if (header.length === 0 || rowCount === 0) {
    post({ kind: 'error', message: 'empty' });
    return;
  }
  sourceName = name;
  cleanedHeader = header;
  cleanedColumns = columns;
  post({
    kind: 'parsed',
    payload: {
      meta: { name, rowCount, columnCount: header.length, bytes },
      preview: previewOf(header, columns),
      report: buildQualityReport(header, columns),
      columnTypes: Object.fromEntries(
        header.map((name2, i) => [name2, inferColumnType(name2, columns[i])]),
      ),
    },
  });
}

function parseText(text: string, name: string, bytes: number) {
  resetState();
  Papa.parse<string[]>(text, {
    skipEmptyLines: true,
    complete: (results) => {
      ingestRows(results.data);
      finishParse(name, bytes);
    },
  });
}

function parseFile(file: File) {
  resetState();
  Papa.parse<string[]>(file, {
    skipEmptyLines: true,
    chunk: (results) => ingestRows(results.data),
    complete: () => finishParse(file.name, file.size),
    error: (error) => post({ kind: 'error', message: error.message }),
  });
}

/** Excel support: SheetJS is loaded lazily, the first sheet becomes CSV. */
async function parseExcel(file: File) {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!firstSheet) {
    post({ kind: 'error', message: 'empty' });
    return;
  }
  parseText(XLSX.utils.sheet_to_csv(firstSheet), file.name, file.size);
}

function cleanedCsv(): string {
  const rows: string[][] = [];
  const total = cleanedColumns[0]?.length ?? 0;
  for (let r = 0; r < total; r++) {
    rows.push(cleanedColumns.map((column) => column[r] ?? ''));
  }
  return Papa.unparse({ fields: cleanedHeader, data: rows }, { newline: '\n' });
}

self.onmessage = async (event: MessageEvent<DataWorkerRequest>) => {
  const request = event.data;
  try {
    if (request.kind === 'parse-file') {
      if (/\.(xlsx|xls)$/i.test(request.file.name)) await parseExcel(request.file);
      else parseFile(request.file);
    } else if (request.kind === 'parse-url') {
      const response = await fetch(request.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      parseText(text, request.name, text.length);
    } else if (request.kind === 'apply') {
      if (header.length === 0) throw new Error('no-data');
      const options = { ...DEFAULT_RECIPE, ...request.options };
      const result = applyRecipe(header, columns, options);
      cleanedHeader = result.header;
      cleanedColumns = result.columns;
      post({
        kind: 'applied',
        payload: {
          report: buildQualityReport(result.header, result.columns),
          preview: previewOf(result.header, result.columns),
          stats: result.stats,
        },
      });
    } else if (request.kind === 'export-csv') {
      if (header.length === 0) throw new Error('no-data');
      const base = sourceName.replace(/\.(csv|tsv|txt|xlsx|xls)$/i, '');
      post({
        kind: 'csv',
        purpose: request.purpose,
        name: `${base}-clean.csv`,
        content: cleanedCsv(),
      });
    }
  } catch (error) {
    post({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};

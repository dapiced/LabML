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
import { buildDriftReport } from '@/features/data/quality/drift';
import { joinDatasets } from '@/features/data/quality/join';
import { DEFAULT_RECIPE } from '@/features/data/quality/types';
import type { Cell } from '@/features/ml/data/types';
import type { DataWorkerRequest, DataWorkerResponse } from '@/features/data/data-protocol';

const PREVIEW_ROWS = 8;
const PROGRESS_EVERY = 5000;

let sourceName = '';
let sourceBytes = 0;
let header: string[] = [];
let columns: Cell[][] = [];
let rowCount = 0;
// Cleaning always restarts from the pristine columns, so toggles never compound.
let cleanedHeader: string[] = [];
let cleanedColumns: Cell[][] = [];
// Ingestion writes into the main dataset or the comparison one (drift/join).
let target: 'main' | 'compare' = 'main';
let compareHeader: string[] = [];
let compareColumns: Cell[][] = [];
let compareRowCount = 0;
// The compare buffers hold a JOIN candidate (not a drift batch) when set.
let joinPending = false;
let joinName = '';

function post(message: DataWorkerResponse) {
  self.postMessage(message);
}

function ingestRows(rows: string[][]) {
  const intoCompare = target === 'compare';
  for (const row of rows) {
    const head = intoCompare ? compareHeader : header;
    if (head.length === 0) {
      const parsedHead = row.map((cell, i) =>
        cell.trim() === '' ? `column_${i + 1}` : cell.trim(),
      );
      const cols = parsedHead.map<Cell[]>(() => []);
      if (intoCompare) {
        compareHeader = parsedHead;
        compareColumns = cols;
      } else {
        header = parsedHead;
        columns = cols;
      }
      continue;
    }
    if (row.length === 1 && row[0].trim() === '') continue;
    const cols = intoCompare ? compareColumns : columns;
    for (let i = 0; i < head.length; i++) {
      cols[i].push(row[i] ?? null);
    }
    if (intoCompare) compareRowCount += 1;
    else {
      rowCount += 1;
      if (rowCount % PROGRESS_EVERY === 0) post({ kind: 'progress', rows: rowCount });
    }
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
  resetCompare();
}

function resetCompare() {
  target = 'main';
  compareHeader = [];
  compareColumns = [];
  compareRowCount = 0;
  joinPending = false;
  joinName = '';
}

function mainPayload() {
  return {
    meta: { name: sourceName, rowCount, columnCount: header.length, bytes: sourceBytes },
    preview: previewOf(header, columns),
    report: buildQualityReport(header, columns),
    columnTypes: Object.fromEntries(
      header.map((name, i) => [name, inferColumnType(name, columns[i])]),
    ),
  };
}

function finishParse(name: string, bytes: number) {
  if (target === 'compare') {
    if (compareHeader.length === 0 || compareRowCount === 0) {
      post({ kind: 'error', message: 'empty' });
      return;
    }
    if (joinPending) {
      // The buffers stay put; the UI answers with apply-join and a key.
      target = 'main';
      joinName = name;
      post({
        kind: 'join-ready',
        name,
        rows: compareRowCount,
        candidates: compareHeader.filter((column) => header.includes(column)),
      });
      return;
    }
    post({
      kind: 'drift',
      meta: { name, rowCount: compareRowCount, columnCount: compareHeader.length, bytes },
      payload: buildDriftReport(header, columns, compareHeader, compareColumns),
    });
    return;
  }
  if (header.length === 0 || rowCount === 0) {
    post({ kind: 'error', message: 'empty' });
    return;
  }
  sourceName = name;
  sourceBytes = bytes;
  cleanedHeader = header;
  cleanedColumns = columns;
  post({ kind: 'parsed', payload: mainPayload() });
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

function parseCompareFile(file: File) {
  Papa.parse<string[]>(file, {
    skipEmptyLines: true,
    chunk: (results) => ingestRows(results.data),
    complete: () => finishParse(file.name, file.size),
    error: (error) => post({ kind: 'error', message: error.message }),
  });
}

async function parseCompareExcel(file: File) {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!firstSheet) {
    post({ kind: 'error', message: 'empty' });
    return;
  }
  Papa.parse<string[]>(XLSX.utils.sheet_to_csv(firstSheet), {
    skipEmptyLines: true,
    complete: (results) => {
      ingestRows(results.data);
      finishParse(file.name, file.size);
    },
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
      resetCompare();
      if (/\.(xlsx|xls)$/i.test(request.file.name)) await parseExcel(request.file);
      else parseFile(request.file);
    } else if (request.kind === 'parse-compare-file') {
      if (header.length === 0) throw new Error('no-data');
      target = 'compare';
      compareHeader = [];
      compareColumns = [];
      compareRowCount = 0;
      joinPending = false;
      if (/\.(xlsx|xls)$/i.test(request.file.name)) await parseCompareExcel(request.file);
      else parseCompareFile(request.file);
    } else if (request.kind === 'parse-compare-url') {
      if (header.length === 0) throw new Error('no-data');
      target = 'compare';
      compareHeader = [];
      compareColumns = [];
      compareRowCount = 0;
      joinPending = false;
      const response = await fetch(request.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      Papa.parse<string[]>(text, {
        skipEmptyLines: true,
        complete: (results) => {
          ingestRows(results.data);
          finishParse(request.name, text.length);
        },
      });
    } else if (request.kind === 'parse-join-file') {
      if (header.length === 0) throw new Error('no-data');
      target = 'compare';
      compareHeader = [];
      compareColumns = [];
      compareRowCount = 0;
      joinPending = true;
      if (/\.(xlsx|xls)$/i.test(request.file.name)) await parseCompareExcel(request.file);
      else parseCompareFile(request.file);
    } else if (request.kind === 'parse-join-url') {
      if (header.length === 0) throw new Error('no-data');
      target = 'compare';
      compareHeader = [];
      compareColumns = [];
      compareRowCount = 0;
      joinPending = true;
      const response = await fetch(request.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      Papa.parse<string[]>(text, {
        skipEmptyLines: true,
        complete: (results) => {
          ingestRows(results.data);
          finishParse(request.name, text.length);
        },
      });
    } else if (request.kind === 'apply-join') {
      if (header.length === 0 || compareHeader.length === 0 || !joinPending) {
        throw new Error('no-join');
      }
      const result = joinDatasets(
        header,
        columns,
        compareHeader,
        compareColumns,
        request.key,
        joinName,
      );
      header = result.header;
      columns = result.columns;
      cleanedHeader = header;
      cleanedColumns = columns;
      resetCompare();
      post({ kind: 'joined', stats: result.stats, payload: mainPayload() });
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

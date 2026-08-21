/// <reference lib="webworker" />
/**
 * The data assistant's worker: the file is parsed here and every question is
 * interpreted and computed here — the page only receives column summaries and
 * structured answers. Same privacy contract as the ML Lab and the Data Studio.
 */
import Papa from 'papaparse';
import { runQuery, type Intent, type QueryResult } from '@/features/ai/chat/engine';
import { parseQuestion, type ColumnInfo } from '@/features/ai/chat/parser';
import { inferColumnType } from '@/features/ml/data/infer';
import { isMissing } from '@/features/ml/data/infer';
import type { Cell, DatasetMeta } from '@/features/ml/data/types';

export type ChatWorkerRequest =
  | { kind: 'parse-file'; file: File }
  | { kind: 'parse-url'; url: string; name: string }
  | { kind: 'ask'; question: string; lang: string };

export type ChatWorkerResponse =
  | { kind: 'ready'; meta: DatasetMeta; columns: ColumnInfo[] }
  | { kind: 'answer'; payload: QueryResult }
  | { kind: 'unknown' }
  | { kind: 'error'; message: string };

/** Category values kept per non-numeric column, for equality filters. */
const MAX_VALUES = 30;

let header: string[] = [];
let columns: Cell[][] = [];
let rowCount = 0;
let columnInfo: ColumnInfo[] = [];

function post(message: ChatWorkerResponse) {
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
  }
}

function resetState() {
  header = [];
  columns = [];
  rowCount = 0;
  columnInfo = [];
}

function buildColumnInfo(): ColumnInfo[] {
  return header.map((name, i) => {
    const type = inferColumnType(name, columns[i]);
    const isNumeric = type === 'numeric' || type === 'id';
    let values: string[] = [];
    if (!isNumeric) {
      const distinct = new Set<string>();
      for (const cell of columns[i]) {
        if (isMissing(cell)) continue;
        distinct.add((cell as string).trim());
        if (distinct.size > MAX_VALUES) break;
      }
      if (distinct.size <= MAX_VALUES) values = [...distinct].sort();
    }
    return { name, isNumeric, values };
  });
}

function finishParse(name: string, bytes: number) {
  if (header.length === 0 || rowCount === 0) {
    post({ kind: 'error', message: 'empty' });
    return;
  }
  columnInfo = buildColumnInfo();
  post({
    kind: 'ready',
    meta: { name, rowCount, columnCount: header.length, bytes },
    columns: columnInfo,
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

self.onmessage = async (event: MessageEvent<ChatWorkerRequest>) => {
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
    } else if (request.kind === 'ask') {
      if (header.length === 0) throw new Error('no-data');
      const intent: Intent | null = parseQuestion(request.question, columnInfo, request.lang);
      if (!intent) {
        post({ kind: 'unknown' });
        return;
      }
      post({ kind: 'answer', payload: runQuery({ header, columns }, intent) });
    }
  } catch (error) {
    post({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};

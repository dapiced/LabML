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
import { buildContract, checkContract, parseContract } from '@/features/data/quality/contract';
import { buildDriftReport } from '@/features/data/quality/drift';
import { joinDatasets } from '@/features/data/quality/join';
import { DEFAULT_RECIPE } from '@/features/data/quality/types';
import type { Cell } from '@/features/ml/data/types';
import { readTable } from '@/features/ml/data/ingest';
import type { ReadFormat } from '@/features/ml/data/locale';
import type { DataWorkerRequest, DataWorkerResponse } from '@/features/data/data-protocol';

const PREVIEW_ROWS = 8;

let sourceName = '';
let sourceBytes = 0;
let header: string[] = [];
let columns: Cell[][] = [];
let rowCount = 0;
// Cleaning always restarts from the pristine columns, so toggles never compound.
let cleanedHeader: string[] = [];
let cleanedColumns: Cell[][] = [];
let compareHeader: string[] = [];
let compareColumns: Cell[][] = [];
let compareRowCount = 0;
// The compare buffers hold a JOIN candidate (not a drift batch) when set.
let joinPending = false;
let joinName = '';

function post(message: DataWorkerResponse) {
  self.postMessage(message);
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
  compareHeader = [];
  compareColumns = [];
  compareRowCount = 0;
  joinPending = false;
  readFormat = null;
  joinName = '';
}

/** V38: how the current file was actually read — announced, never assumed. */
let readFormat: ReadFormat | null = null;

function mainPayload() {
  return {
    meta: { name: sourceName, rowCount, columnCount: header.length, bytes: sourceBytes },
    preview: previewOf(header, columns),
    report: buildQualityReport(header, columns),
    columnTypes: Object.fromEntries(
      header.map((name, i) => [name, inferColumnType(name, columns[i])]),
    ),
    ...(readFormat !== null && { readFormat }),
  };
}

/**
 * V54: the reading itself lives in `ingest.ts`, shared with the ML Lab and the
 * chat, so the Studio now has the same memory budget and the same named
 * refusals (`too-large:rows:cols`, `empty`), thrown there and posted by the
 * handler below.
 */
async function loadMain(source: File | string, name: string, bytes: number) {
  resetState();
  const table = await readTable(source, {
    onProgress: (rows) => post({ kind: 'progress', rows }),
  });
  header = table.header;
  columns = table.columns;
  rowCount = table.rowCount;
  readFormat = table.readFormat;
  sourceName = name;
  sourceBytes = bytes;
  cleanedHeader = header;
  cleanedColumns = columns;
  post({ kind: 'parsed', payload: mainPayload() });
}

/**
 * A drift batch or a join candidate. It is read exactly like the main file,
 * decimals included: comparing a French export against a normalised dataset
 * would otherwise report a drift that is nothing but a decimal separator.
 */
async function loadCompare(
  source: File | string,
  name: string,
  bytes: number,
  purpose: 'drift' | 'join',
) {
  if (header.length === 0) throw new Error('no-data');
  compareHeader = [];
  compareColumns = [];
  compareRowCount = 0;
  joinPending = false;
  const table = await readTable(source);
  compareHeader = table.header;
  compareColumns = table.columns;
  compareRowCount = table.rowCount;
  if (purpose === 'join') {
    // The buffers stay put; the UI answers with apply-join and a key.
    joinPending = true;
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
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
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
      await loadMain(request.file, request.file.name, request.file.size);
    } else if (request.kind === 'parse-compare-file') {
      await loadCompare(request.file, request.file.name, request.file.size, 'drift');
    } else if (request.kind === 'parse-compare-url') {
      const text = await fetchText(request.url);
      await loadCompare(text, request.name, text.length, 'drift');
    } else if (request.kind === 'parse-join-file') {
      await loadCompare(request.file, request.file.name, request.file.size, 'join');
    } else if (request.kind === 'parse-join-url') {
      const text = await fetchText(request.url);
      await loadCompare(text, request.name, text.length, 'join');
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
      const text = await fetchText(request.url);
      await loadMain(text, request.name, text.length);
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
    } else if (request.kind === 'export-contract') {
      if (header.length === 0) throw new Error('no-data');
      const base = sourceName.replace(/\.(csv|tsv|txt|xlsx|xls)$/i, '');
      post({
        kind: 'contract',
        name: `${base}.contract.json`,
        // The file as it was read, before the recipe: what a new export looks like.
        content: JSON.stringify(buildContract(header, columns, sourceName), null, 2),
      });
    } else if (request.kind === 'check-contract') {
      if (header.length === 0) throw new Error('no-data');
      const contract = parseContract(request.text);
      if (!contract) {
        post({ kind: 'contract-refused' });
      } else {
        post({
          kind: 'contract-checked',
          source: contract.source,
          createdAt: contract.createdAt,
          payload: checkContract(contract, header, columns),
        });
      }
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

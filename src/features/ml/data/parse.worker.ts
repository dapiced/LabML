/// <reference lib="webworker" />
import Papa from 'papaparse';
import { profileColumn } from '@/features/ml/data/profile';
import { analyzeTarget, baselineSuggestions } from '@/features/ml/data/suggest';
import { computeInsights, computeWhatIf } from '@/features/ml/train/insights';
import { runTraining, type TrainArtifacts } from '@/features/ml/train/trainer';
import type { Cell, ColumnProfile, ParseResultPayload } from '@/features/ml/data/types';
import type { WorkerRequest, WorkerResponse } from '@/features/ml/worker-protocol';

const PREVIEW_ROWS = 50;
const PROGRESS_EVERY = 5000;

// The parsed dataset stays in the worker: the UI only receives profiles and a
// small preview, and later sprints train models here without ever moving the
// data back to the main thread (or anywhere else).
let header: string[] = [];
let columns: Cell[][] = [];
let rowCount = 0;
let cancelTraining = false;
let artifacts: TrainArtifacts | null = null;

function post(message: WorkerResponse) {
  self.postMessage(message);
}

function ingestRows(rows: string[][]) {
  for (const row of rows) {
    if (header.length === 0) {
      header = row.map((cell, i) => (cell.trim() === '' ? `column_${i + 1}` : cell.trim()));
      columns = header.map(() => []);
      continue;
    }
    // Skip fully empty trailing lines.
    if (row.length === 1 && row[0].trim() === '') continue;
    for (let i = 0; i < header.length; i++) {
      columns[i].push(row[i] ?? null);
    }
    rowCount += 1;
    if (rowCount % PROGRESS_EVERY === 0) post({ kind: 'progress', rows: rowCount });
  }
}

function buildResult(name: string, bytes: number): ParseResultPayload {
  const profiles: ColumnProfile[] = header.map((column, i) => profileColumn(column, columns[i]));
  const preview: Record<string, string>[] = [];
  for (let r = 0; r < Math.min(PREVIEW_ROWS, rowCount); r++) {
    const row: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) {
      row[header[c]] = columns[c][r] ?? '';
    }
    preview.push(row);
  }
  return {
    meta: { name, rowCount, columnCount: header.length, bytes },
    profiles,
    preview,
    suggestions: baselineSuggestions(profiles),
  };
}

function columnsAsMap(): Map<string, Cell[]> {
  return new Map(header.map((name, i) => [name, columns[i]]));
}

function resetState() {
  header = [];
  columns = [];
  rowCount = 0;
  artifacts = null;
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

function finishParse(name: string, bytes: number) {
  if (header.length === 0 || rowCount === 0) {
    post({ kind: 'error', message: 'empty' });
    return;
  }
  post({ kind: 'parsed', payload: buildResult(name, bytes) });
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    if (request.kind === 'parse-file') {
      parseFile(request.file);
    } else if (request.kind === 'parse-url') {
      const response = await fetch(request.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      parseText(text, request.name, text.length);
    } else if (request.kind === 'analyze-target') {
      const profiles: ColumnProfile[] = header.map((column, i) =>
        profileColumn(column, columns[i]),
      );
      post({
        kind: 'target-analyzed',
        payload: analyzeTarget(request.target, columnsAsMap(), profiles),
      });
    } else if (request.kind === 'cancel-train') {
      cancelTraining = true;
    } else if (request.kind === 'train') {
      cancelTraining = false;
      artifacts = null;
      const profiles: ColumnProfile[] = header.map((column, i) =>
        profileColumn(column, columns[i]),
      );
      const outcome = await runTraining(columnsAsMap(), profiles, request.config, {
        onModelStart: (key, index, total) => post({ kind: 'model-start', key, index, total }),
        onModelResult: (result) => post({ kind: 'model-result', result }),
        isCancelled: () => cancelTraining,
      });
      if (outcome) {
        artifacts = outcome.artifacts;
        post({ kind: 'train-complete', summary: outcome.summary });
      } else {
        post({ kind: 'train-cancelled' });
      }
    } else if (request.kind === 'model-insights') {
      if (!artifacts) throw new Error('no-run');
      post({ kind: 'insights', payload: computeInsights(artifacts, request.model) });
    } else if (request.kind === 'what-if') {
      if (!artifacts) throw new Error('no-run');
      post({
        kind: 'what-if-result',
        payload: computeWhatIf(artifacts, request.model, request.values),
      });
    }
  } catch (error) {
    post({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};

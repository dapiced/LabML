/// <reference lib="webworker" />
import Papa from 'papaparse';
import { MAX_CELLS } from '@/features/ml/data/limits';
import { profileColumn } from '@/features/ml/data/profile';
import { analyzeTarget, baselineSuggestions } from '@/features/ml/data/suggest';
import { computeInsights, computeWhatIf } from '@/features/ml/train/insights';
import { runLearningCurve } from '@/features/ml/train/learning-curve';
import { runSearch } from '@/features/ml/train/search';
import { runExploration } from '@/features/ml/unsupervised/explore';
import { runForecast } from '@/features/ml/timeseries/run';
import { buildPredictionsCsv, serializeModel } from '@/features/ml/train/serialize';
import { explainPrediction } from '@/features/ml/train/shapley';
import { deserializeModel, type ImportedModel } from '@/features/ml/train/deserialize';
import { scoreBatch, scoreRows } from '@/features/ml/train/score';
import { analyzeSegments } from '@/features/ml/train/segments';
import { analyzeThresholds } from '@/features/ml/train/threshold-analysis';
import { analyzeUncertainty, type ModelLosses } from '@/features/ml/train/uncertainty';
import { runTraining, type TrainArtifacts } from '@/features/ml/train/trainer';
import type { Cell, ColumnProfile, ParseResultPayload } from '@/features/ml/data/types';
import type { ModelKey } from '@/features/ml/train/types';
import type { WorkerRequest, WorkerResponse } from '@/features/ml/worker-protocol';

const PREVIEW_ROWS = 50;
const PROGRESS_EVERY = 5000;

// The parsed dataset stays in the worker: the UI only receives profiles and a
// small preview, and later sprints train models here without ever moving the
// data back to the main thread (or anywhere else).
let header: string[] = [];
let columns: Cell[][] = [];
let rowCount = 0;
/** V25 memory guard: set when the stream blew the MAX_CELLS budget. */
let overflowed = false;
let cancelTraining = false;
let cancelTuning = false;
let cancelCurve = false;
let artifacts: TrainArtifacts | null = null;
/** Target column of the last training — batch metrics need it by name. */
let lastTarget: string | null = null;
/** Feature columns of the last training — segment analysis flags them. */
let lastFeatureColumns: string[] = [];
/** Name of the parsed dataset — the model export manifest carries it. */
let datasetName = '';
/** v22: a model rebuilt from an export — fully independent of any run. */
let imported: ImportedModel | null = null;

function post(message: WorkerResponse) {
  self.postMessage(message);
}

/** Returns false when the MAX_CELLS budget is blown — callers stop the stream. */
function ingestRows(rows: string[][]): boolean {
  for (const row of rows) {
    if (header.length === 0) {
      header = row.map((cell, i) => (cell.trim() === '' ? `column_${i + 1}` : cell.trim()));
      columns = header.map(() => []);
      continue;
    }
    // Skip fully empty trailing lines.
    if (row.length === 1 && row[0].trim() === '') continue;
    // V25: named memory guard — refuse past MAX_CELLS instead of dying silently.
    if ((rowCount + 1) * header.length > MAX_CELLS) {
      overflowed = true;
      return false;
    }
    for (let i = 0; i < header.length; i++) {
      columns[i].push(row[i] ?? null);
    }
    rowCount += 1;
    if (rowCount % PROGRESS_EVERY === 0) post({ kind: 'progress', rows: rowCount });
  }
  return true;
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
  overflowed = false;
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
    chunk: (results, parser) => {
      // Stop reading the file the moment the budget is blown (streaming abort).
      if (!ingestRows(results.data)) parser.abort();
    },
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

function finishParse(name: string, bytes: number) {
  if (overflowed) {
    // Named numeric refusal: the UI spells out the budget and where we stopped.
    post({ kind: 'error', message: `too-large:${rowCount}:${header.length}` });
    resetState();
    return;
  }
  if (header.length === 0 || rowCount === 0) {
    post({ kind: 'error', message: 'empty' });
    return;
  }
  datasetName = name;
  post({ kind: 'parsed', payload: buildResult(name, bytes) });
}

/**
 * Parses a NEW batch into local structures — the main dataset and the run
 * artifacts stay untouched, whatever is in the file.
 */
async function parseBatch(source: File | string): Promise<{ header: string[]; cols: Cell[][] }> {
  let text: string;
  if (typeof source === 'string') {
    text = source;
  } else if (/\.(xlsx|xls)$/i.test(source.name)) {
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(new Uint8Array(await source.arrayBuffer()), { type: 'array' });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!firstSheet) throw new Error('empty');
    text = XLSX.utils.sheet_to_csv(firstSheet);
  } else {
    text = await source.text();
  }
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
  const rows = parsed.data;
  if (rows.length < 2) throw new Error('empty');
  const batchHeader = rows[0].map((cell, i) =>
    cell.trim() === '' ? `column_${i + 1}` : cell.trim(),
  );
  const cols: Cell[][] = batchHeader.map(() => []);
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length === 1 && row[0].trim() === '') continue;
    for (let c = 0; c < batchHeader.length; c++) cols[c].push(row[c] ?? null);
  }
  return { header: batchHeader, cols };
}

async function handleScoreBatch(source: File | string, name: string, model: ModelKey) {
  try {
    if (!artifacts || !lastTarget) throw new Error('no-run');
    const batch = await parseBatch(source);
    post({
      kind: 'batch-scored',
      payload: scoreBatch(artifacts, model, lastTarget, name, batch.header, batch.cols),
    });
  } catch (error) {
    post({ kind: 'batch-error', message: error instanceof Error ? error.message : String(error) });
  }
}

async function handleScoreImported(source: File | string, name: string) {
  try {
    if (!imported) throw new Error('no-model');
    const batch = await parseBatch(source);
    post({
      kind: 'imported-scored',
      payload: scoreRows(
        {
          model: imported.model,
          specs: imported.specs,
          transformRow: imported.transformRow,
          classes: imported.manifest.classes,
          isClassification: imported.manifest.isClassification,
        },
        imported.manifest.model,
        imported.manifest.testMetrics,
        imported.manifest.target,
        name,
        batch.header,
        batch.cols,
      ),
    });
  } catch (error) {
    post({ kind: 'import-error', message: error instanceof Error ? error.message : String(error) });
  }
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
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
    } else if (request.kind === 'parse-text') {
      parseText(request.text, request.name, request.text.length);
    } else if (request.kind === 'export-dataset') {
      if (header.length === 0) throw new Error('no-data');
      const rows: string[][] = [header];
      for (let r = 0; r < rowCount; r++) {
        rows.push(header.map((_, c) => columns[c][r] ?? ''));
      }
      post({ kind: 'dataset-csv', csv: Papa.unparse(rows, { newline: '\n' }) });
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
      lastTarget = request.config.target;
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
        lastFeatureColumns = outcome.summary.featureColumns;
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
    } else if (request.kind === 'explain') {
      if (!artifacts) throw new Error('no-run');
      post({
        kind: 'explanation',
        payload: explainPrediction(artifacts, request.model, request.values),
      });
    } else if (request.kind === 'cancel-curve') {
      cancelCurve = true;
    } else if (request.kind === 'learning-curve') {
      cancelCurve = false;
      if (!artifacts) throw new Error('no-run');
      const profiles: ColumnProfile[] = header.map((column, i) =>
        profileColumn(column, columns[i]),
      );
      const outcome = await runLearningCurve(
        columnsAsMap(),
        profiles,
        request.config,
        request.model,
        {
          onProgress: (done, total) => post({ kind: 'curve-progress', done, total }),
          isCancelled: () => cancelCurve,
        },
      );
      if (cancelCurve) post({ kind: 'curve-cancelled' });
      else post({ kind: 'curve-complete', payload: outcome });
    } else if (request.kind === 'cancel-tune') {
      cancelTuning = true;
    } else if (request.kind === 'tune') {
      cancelTuning = false;
      if (!artifacts) throw new Error('no-run');
      const profiles: ColumnProfile[] = header.map((column, i) =>
        profileColumn(column, columns[i]),
      );
      const outcome = await runSearch(
        columnsAsMap(),
        profiles,
        request.config,
        request.model,
        artifacts.models.get(request.model) ?? null,
        {
          onProgress: (done, total, bestCv) => post({ kind: 'tune-progress', done, total, bestCv }),
          isCancelled: () => cancelTuning,
        },
      );
      if (outcome) post({ kind: 'tune-complete', payload: outcome });
      else post({ kind: 'tune-cancelled' });
    } else if (request.kind === 'explore') {
      if (header.length === 0) throw new Error('no-data');
      const profiles: ColumnProfile[] = header.map((column, i) =>
        profileColumn(column, columns[i]),
      );
      post({
        kind: 'explore-result',
        payload: runExploration(columnsAsMap(), profiles, request.features, request.seed),
      });
    } else if (request.kind === 'forecast') {
      if (header.length === 0) throw new Error('no-data');
      const dateIndex = header.indexOf(request.dateColumn);
      const valueIndex = header.indexOf(request.valueColumn);
      if (dateIndex < 0 || valueIndex < 0) throw new Error('unknown-column');
      post({
        kind: 'forecast-result',
        payload: runForecast(
          columns[dateIndex],
          columns[valueIndex],
          request.dateColumn,
          request.valueColumn,
        ),
      });
    } else if (request.kind === 'export-model') {
      if (!artifacts || !lastTarget) throw new Error('no-run');
      post({
        kind: 'model-json',
        model: request.model,
        json: serializeModel(artifacts, request.model, {
          target: lastTarget,
          datasetName,
          rowCount,
        }),
      });
    } else if (request.kind === 'export-predictions') {
      if (!artifacts) throw new Error('no-run');
      post({
        kind: 'predictions-csv',
        model: request.model,
        csv: buildPredictionsCsv(artifacts, request.model),
      });
    } else if (request.kind === 'threshold-analysis') {
      if (!artifacts) throw new Error('no-run');
      post({ kind: 'threshold-result', payload: analyzeThresholds(artifacts, request.model) });
    } else if (request.kind === 'uncertainty-analysis') {
      if (!artifacts) throw new Error('no-run');
      const art = artifacts;
      const entries: ModelLosses[] = [...art.models.entries()].map(([model, trained]) => {
        const yhat = trained.predict(art.testX);
        const values = art.isClassification
          ? yhat.map((p, i) => (p === art.testY[i] ? 1 : 0))
          : yhat.map((p, i) => (p - art.testY[i]) ** 2);
        return { model, values };
      });
      post({
        kind: 'uncertainty-result',
        payload: analyzeUncertainty(entries, art.isClassification, art.seed),
      });
    } else if (request.kind === 'segment-analysis') {
      if (!artifacts || !lastTarget) throw new Error('no-run');
      const model = artifacts.models.get(request.model);
      if (!model) throw new Error('model-not-found');
      post({
        kind: 'segments-result',
        payload: analyzeSegments(
          header,
          columns,
          artifacts.testIndices,
          artifacts.testY,
          model.predict(artifacts.testX),
          artifacts.isClassification,
          lastTarget,
          lastFeatureColumns,
          request.model,
        ),
      });
    } else if (request.kind === 'load-model') {
      try {
        imported = deserializeModel(request.text);
        post({ kind: 'model-loaded', manifest: imported.manifest });
      } catch (error) {
        imported = null;
        post({
          kind: 'import-error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } else if (request.kind === 'score-imported-file') {
      await handleScoreImported(request.file, request.file.name);
    } else if (request.kind === 'score-imported-url') {
      const response = await fetch(request.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await handleScoreImported(await response.text(), request.name);
    } else if (request.kind === 'score-batch-file') {
      await handleScoreBatch(request.file, request.file.name, request.model);
    } else if (request.kind === 'score-batch-url') {
      const response = await fetch(request.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await handleScoreBatch(await response.text(), request.name, request.model);
    }
  } catch (error) {
    post({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};

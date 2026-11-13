/// <reference lib="webworker" />
import Papa from 'papaparse';
import { auditGroups } from '@/features/ml/train/group-audit';
import { profileColumn } from '@/features/ml/data/profile';
import { analyzeTarget, baselineSuggestions } from '@/features/ml/data/suggest';
import { computeInsights, computeWhatIf } from '@/features/ml/train/insights';
import { runLearningCurve } from '@/features/ml/train/learning-curve';
import { robustRank } from '@/features/ml/train/robust';
import { createJournal } from '@/features/ml/train/journal';
import { trainInParallel } from '@/features/ml/train/parallel-run';
import { runSearch } from '@/features/ml/train/search';
import { runExploration } from '@/features/ml/unsupervised/explore';
import { runForecast } from '@/features/ml/timeseries/run';
import { buildPredictionsCsv, referenceOf, serializeModel } from '@/features/ml/train/serialize';
import { explainPrediction } from '@/features/ml/train/shapley';
import { deserializeModel, type ImportedModel } from '@/features/ml/train/deserialize';
import { scoreBatch, scoreRows } from '@/features/ml/train/score';
import { analyzeSegments } from '@/features/ml/train/segments';
import { analyzeThresholds } from '@/features/ml/train/threshold-analysis';
import { analyzeConformal } from '@/features/ml/train/conformal-analysis';
import {
  analyzeMulticlassDecision,
  testMulticlassDecision,
} from '@/features/ml/train/multiclass-decision-analysis';
import { analyzeUncertainty, type ModelLosses } from '@/features/ml/train/uncertainty';
import { detectTaskType, runTraining, type TrainArtifacts } from '@/features/ml/train/trainer';
import type { Cell, ColumnProfile, ParseResultPayload } from '@/features/ml/data/types';
import type { ModelKey } from '@/features/ml/train/types';
import { readTable } from '@/features/ml/data/ingest';
import type { ReadFormat } from '@/features/ml/data/locale';
import type { WorkerRequest, WorkerResponse } from '@/features/ml/worker-protocol';

const PREVIEW_ROWS = 50;

// The parsed dataset stays in the worker: the UI only receives profiles and a
// small preview, and later sprints train models here without ever moving the
// data back to the main thread (or anywhere else).
let header: string[] = [];
let columns: Cell[][] = [];
let rowCount = 0;
let cancelTraining = false;
let cancelTuning = false;
let cancelCurve = false;
let cancelRobust = false;
let artifacts: TrainArtifacts | null = null;
/** Target column of the last training — batch metrics need it by name. */
let lastTarget: string | null = null;
/** Feature columns of the last training — segment analysis flags them. */
let lastFeatureColumns: string[] = [];
/** Name of the parsed dataset — the model export manifest carries it. */
let datasetName = '';
/** v22: a model rebuilt from an export — fully independent of any run. */
let imported: ImportedModel | null = null;
/** V38: how the current file was actually read — announced, never assumed. */
let readFormat: ReadFormat | null = null;

function post(message: WorkerResponse) {
  self.postMessage(message);
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
    ...(readFormat !== null && { readFormat }),
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
  readFormat = null;
}

/**
 * V54: the reading itself lives in `ingest.ts`, shared with the Data Studio
 * and the chat. A refusal (`too-large:rows:cols`, `empty`) is thrown there and
 * posted by the handler below; the previous dataset is already gone by then,
 * as it always was.
 */
async function loadDataset(source: File | string, name: string, bytes: number) {
  resetState();
  const table = await readTable(source, {
    onProgress: (rows) => post({ kind: 'progress', rows }),
  });
  header = table.header;
  columns = table.columns;
  rowCount = table.rowCount;
  readFormat = table.readFormat;
  datasetName = name;
  post({ kind: 'parsed', payload: buildResult(name, bytes) });
}

/**
 * Parses a NEW batch into local structures — the main dataset and the run
 * artifacts stay untouched, whatever is in the file. V38: a batch is read
 * exactly like the training file was — a French batch scored against a model
 * trained on normalised numbers would otherwise be compared against garbage.
 * V54: and under the same memory budget.
 */
async function parseBatch(source: File | string): Promise<{ header: string[]; cols: Cell[][] }> {
  const table = await readTable(source);
  return { header: table.header, cols: table.columns };
}

async function handleScoreBatch(
  source: File | string,
  name: string,
  model: ModelKey,
  decisionPolicy?: import('@/features/ml/train/multiclass-decision').MulticlassDecisionPolicy,
) {
  try {
    if (!artifacts || !lastTarget) throw new Error('no-run');
    const batch = await parseBatch(source);
    post({
      kind: 'batch-scored',
      payload: scoreBatch(
        artifacts,
        model,
        lastTarget,
        name,
        batch.header,
        batch.cols,
        decisionPolicy,
        // V61: a live run builds its reference on the spot, from its own rows.
        {
          reference: referenceOf(artifacts, model, columnsAsMap()),
          testRows: artifacts.testY.length,
        },
      ),
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
          ...(imported.manifest.decisionPolicy
            ? { decisionPolicy: imported.manifest.decisionPolicy }
            : {}),
        },
        imported.manifest.model,
        imported.manifest.testMetrics,
        imported.manifest.target,
        name,
        batch.header,
        batch.cols,
        // V61: the reference the export carried, or none for an older file.
        {
          reference: imported.manifest.reference ?? null,
          testRows: imported.manifest.testRows,
        },
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
      await loadDataset(request.file, request.file.name, request.file.size);
    } else if (request.kind === 'parse-url') {
      const response = await fetch(request.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      await loadDataset(text, request.name, text.length);
    } else if (request.kind === 'parse-text') {
      await loadDataset(request.text, request.name, request.text.length);
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
      // V37: the heavy families first, on other cores. Best-effort — anything
      // that does not come back is fitted by the sequential loop below. An
      // undetectable task skips the parallel phase entirely so that runTraining
      // stays the code that raises the named error.
      const taskType = detectTaskType(columnsAsMap(), profiles, request.config);
      // V55: one journal for the whole run, parallel phase included.
      const journal = createJournal();
      const parallel =
        taskType === null
          ? { pretrained: undefined, report: null }
          : await trainInParallel(
              header,
              columns,
              request.config,
              taskType === 'classification',
              () => undefined,
              () => cancelTraining,
              journal,
            );

      const outcome = await runTraining(
        columnsAsMap(),
        profiles,
        request.config,
        {
          onModelStart: (key, index, total) => post({ kind: 'model-start', key, index, total }),
          onModelResult: (result) => post({ kind: 'model-result', result }),
          isCancelled: () => cancelTraining,
        },
        parallel.pretrained,
        journal,
      );
      if (outcome) {
        artifacts = outcome.artifacts;
        lastFeatureColumns = outcome.summary.featureColumns;
        post({
          kind: 'train-complete',
          summary:
            parallel.report === null
              ? outcome.summary
              : {
                  ...outcome.summary,
                  parallel: {
                    helpers: parallel.report.helpers,
                    families: parallel.report.families,
                  },
                },
        });
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
    } else if (request.kind === 'cancel-robust') {
      cancelRobust = true;
    } else if (request.kind === 'robust-rank') {
      cancelRobust = false;
      if (!artifacts) throw new Error('no-run');
      const profiles: ColumnProfile[] = header.map((column, i) =>
        profileColumn(column, columns[i]),
      );
      // V35: ten fits per family on train+validation halves. The test rows
      // never enter the folds — this reranks, it does not re-test.
      const payload = await robustRank(columnsAsMap(), profiles, request.config, {
        onProgress: (done, total) => post({ kind: 'robust-progress', done, total }),
        isCancelled: () => cancelRobust,
      });
      if (payload === null) post({ kind: 'robust-cancelled' });
      else post({ kind: 'robust-complete', payload });
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
        json: serializeModel(
          artifacts,
          request.model,
          {
            target: lastTarget,
            datasetName,
            rowCount,
          },
          request.decisionPolicy,
          referenceOf(artifacts, request.model, columnsAsMap()),
        ),
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
      post({
        kind: 'threshold-result',
        payload: analyzeThresholds(artifacts, request.model, request.focusClass),
      });
    } else if (request.kind === 'multiclass-decision-analysis') {
      if (!artifacts) throw new Error('no-run');
      post({
        kind: 'multiclass-decision-result',
        payload: analyzeMulticlassDecision(artifacts, request.model),
      });
    } else if (request.kind === 'multiclass-decision-test') {
      if (!artifacts) throw new Error('no-run');
      post({
        kind: 'multiclass-decision-tested',
        model: request.model,
        payload: testMulticlassDecision(
          artifacts,
          request.model,
          request.policy,
          request.exploratory,
        ),
      });
    } else if (request.kind === 'conformal-analysis') {
      if (!artifacts) throw new Error('no-run');
      post({
        kind: 'conformal-result',
        payload: analyzeConformal(artifacts, request.model, request.alpha),
      });
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
    } else if (request.kind === 'group-audit') {
      if (!artifacts || !lastTarget) throw new Error('no-run');
      const model = artifacts.models.get(request.model);
      if (!model) throw new Error('model-not-found');
      // V59: the audit reads the decision the user would actually take. With
      // a threshold set on a binary model, that is the cut, not the default.
      const cut =
        request.threshold !== undefined && artifacts.classes.length === 2 && model.predictProba
          ? request.threshold
          : undefined;
      const predictions =
        cut !== undefined
          ? model.predictProba!(artifacts.testX).map((row) => ((row[1] ?? 0) >= cut ? 1 : 0))
          : model.predict(artifacts.testX);
      post({
        kind: 'group-audit-result',
        payload: auditGroups({
          header,
          columns,
          testIndices: artifacts.testIndices,
          testY: artifacts.testY,
          predictions,
          classes: artifacts.classes,
          isClassification: artifacts.isClassification,
          target: lastTarget,
          featureColumns: lastFeatureColumns,
          model: request.model,
          column: request.column,
          seed: artifacts.seed,
          ...(cut !== undefined && { threshold: cut }),
        }),
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
      await handleScoreBatch(
        request.file,
        request.file.name,
        request.model,
        request.decisionPolicy,
      );
    } else if (request.kind === 'score-batch-url') {
      const response = await fetch(request.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await handleScoreBatch(
        await response.text(),
        request.name,
        request.model,
        request.decisionPolicy,
      );
    }
  } catch (error) {
    post({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};

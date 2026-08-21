import type { Cell, ParseResultPayload, TargetAnalysis } from '@/features/ml/data/types';
import type { ImportedManifest } from '@/features/ml/train/deserialize';
import type { ExplorationPayload } from '@/features/ml/unsupervised/explore';
import type { ForecastPayload } from '@/features/ml/timeseries/run';
import type { BatchScore } from '@/features/ml/train/score';
import type { SegmentAnalysis } from '@/features/ml/train/segments';
import type { TunableKey, TuneOutcome } from '@/features/ml/train/search';
import type { LearningCurveOutcome } from '@/features/ml/train/learning-curve';
import type { ThresholdAnalysis } from '@/features/ml/train/threshold-analysis';
import type { UncertaintyAnalysis } from '@/features/ml/train/uncertainty';
import type { ShapleyExplanation } from '@/features/ml/train/shapley';
import type {
  InsightsPayload,
  ModelKey,
  ModelResult,
  TrainConfig,
  TrainSummary,
  WhatIfResult,
} from '@/features/ml/train/types';

/** Messages accepted by the data/training worker. */
export type WorkerRequest =
  | { kind: 'parse-file'; file: File }
  | { kind: 'parse-url'; url: string; name: string }
  // Reopening a dataset stored in the browser (v19 persistent projects).
  | { kind: 'parse-text'; text: string; name: string }
  | { kind: 'export-dataset' }
  | { kind: 'analyze-target'; target: string }
  | { kind: 'train'; config: TrainConfig }
  | { kind: 'cancel-train' }
  | { kind: 'model-insights'; model: ModelKey }
  | { kind: 'what-if'; model: ModelKey; values: Record<string, Cell> }
  | { kind: 'explain'; model: ModelKey; values: Record<string, Cell> }
  | { kind: 'tune'; model: TunableKey; config: TrainConfig }
  | { kind: 'cancel-tune' }
  // v26: learning curve — retrain on growing seeded prefixes of the train split.
  | { kind: 'learning-curve'; model: ModelKey; config: TrainConfig }
  | { kind: 'cancel-curve' }
  | { kind: 'explore'; features: string[]; seed: number }
  | { kind: 'forecast'; dateColumn: string; valueColumn: string }
  | { kind: 'export-model'; model: ModelKey }
  | { kind: 'export-predictions'; model: ModelKey }
  | { kind: 'score-batch-file'; file: File; model: ModelKey }
  | { kind: 'score-batch-url'; url: string; name: string; model: ModelKey }
  | { kind: 'threshold-analysis'; model: ModelKey }
  | { kind: 'segment-analysis'; model: ModelKey }
  | { kind: 'uncertainty-analysis' }
  // v22: an exported model comes back to score files, no retraining.
  | { kind: 'load-model'; text: string }
  | { kind: 'score-imported-file'; file: File }
  | { kind: 'score-imported-url'; url: string; name: string };

/** Messages emitted by the data/training worker. */
export type WorkerResponse =
  | { kind: 'progress'; rows: number }
  | { kind: 'parsed'; payload: ParseResultPayload }
  | { kind: 'target-analyzed'; payload: TargetAnalysis }
  | { kind: 'model-start'; key: ModelKey; index: number; total: number }
  | { kind: 'model-result'; result: ModelResult }
  | { kind: 'train-complete'; summary: TrainSummary }
  | { kind: 'train-cancelled' }
  | { kind: 'insights'; payload: InsightsPayload }
  | { kind: 'what-if-result'; payload: WhatIfResult }
  | { kind: 'explanation'; payload: ShapleyExplanation }
  | { kind: 'tune-progress'; done: number; total: number; bestCv: number | null }
  | { kind: 'tune-complete'; payload: TuneOutcome }
  | { kind: 'tune-cancelled' }
  | { kind: 'curve-progress'; done: number; total: number }
  // null = refused by name (baseline, or a ladder with a single rung).
  | { kind: 'curve-complete'; payload: LearningCurveOutcome | null }
  | { kind: 'curve-cancelled' }
  | { kind: 'explore-result'; payload: ExplorationPayload }
  | { kind: 'forecast-result'; payload: ForecastPayload }
  | { kind: 'model-json'; model: ModelKey; json: string | null }
  | { kind: 'predictions-csv'; model: ModelKey; csv: string }
  | { kind: 'batch-scored'; payload: BatchScore }
  // The current dataset rebuilt as CSV, for local persistence.
  | { kind: 'dataset-csv'; csv: string }
  // null = not applicable (multiclass, regression, or no probabilities).
  | { kind: 'threshold-result'; payload: ThresholdAnalysis | null }
  // null = nothing sliceable (no categorical column, tiny test set).
  | { kind: 'segments-result'; payload: SegmentAnalysis | null }
  // null = tiny test set — no interval theater.
  | { kind: 'uncertainty-result'; payload: UncertaintyAnalysis | null }
  // Dedicated channel: a bad batch file must not tear down the run state.
  | { kind: 'batch-error'; message: string }
  // v22 import flow — its errors never touch the run or dataset state.
  | { kind: 'model-loaded'; manifest: ImportedManifest }
  | { kind: 'imported-scored'; payload: BatchScore }
  | { kind: 'import-error'; message: string }
  | { kind: 'error'; message: string };

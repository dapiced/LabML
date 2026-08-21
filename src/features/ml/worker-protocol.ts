import type { Cell, ParseResultPayload, TargetAnalysis } from '@/features/ml/data/types';
import type { ExplorationPayload } from '@/features/ml/unsupervised/explore';
import type { ForecastPayload } from '@/features/ml/timeseries/run';
import type { BatchScore } from '@/features/ml/train/score';
import type { TunableKey, TuneOutcome } from '@/features/ml/train/search';
import type { ThresholdAnalysis } from '@/features/ml/train/threshold-analysis';
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
  | { kind: 'analyze-target'; target: string }
  | { kind: 'train'; config: TrainConfig }
  | { kind: 'cancel-train' }
  | { kind: 'model-insights'; model: ModelKey }
  | { kind: 'what-if'; model: ModelKey; values: Record<string, Cell> }
  | { kind: 'explain'; model: ModelKey; values: Record<string, Cell> }
  | { kind: 'tune'; model: TunableKey; config: TrainConfig }
  | { kind: 'cancel-tune' }
  | { kind: 'explore'; features: string[]; seed: number }
  | { kind: 'forecast'; dateColumn: string; valueColumn: string }
  | { kind: 'export-model'; model: ModelKey }
  | { kind: 'export-predictions'; model: ModelKey }
  | { kind: 'score-batch-file'; file: File; model: ModelKey }
  | { kind: 'score-batch-url'; url: string; name: string; model: ModelKey }
  | { kind: 'threshold-analysis'; model: ModelKey };

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
  | { kind: 'explore-result'; payload: ExplorationPayload }
  | { kind: 'forecast-result'; payload: ForecastPayload }
  | { kind: 'model-json'; model: ModelKey; json: string | null }
  | { kind: 'predictions-csv'; model: ModelKey; csv: string }
  | { kind: 'batch-scored'; payload: BatchScore }
  // null = not applicable (multiclass, regression, or no probabilities).
  | { kind: 'threshold-result'; payload: ThresholdAnalysis | null }
  // Dedicated channel: a bad batch file must not tear down the run state.
  | { kind: 'batch-error'; message: string }
  | { kind: 'error'; message: string };

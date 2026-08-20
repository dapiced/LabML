import type { Cell, ParseResultPayload, TargetAnalysis } from '@/features/ml/data/types';
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
  | { kind: 'what-if'; model: ModelKey; values: Record<string, Cell> };

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
  | { kind: 'error'; message: string };

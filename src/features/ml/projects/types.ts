import type { TaskType } from '@/features/ml/data/types';
import type { BatchScore } from '@/features/ml/train/score';
import type { ShapleyExplanation } from '@/features/ml/train/shapley';
import type { TuneOutcome } from '@/features/ml/train/search';
import type { ExplorationPayload } from '@/features/ml/unsupervised/explore';
import type { ForecastPayload } from '@/features/ml/timeseries/run';
import type { InsightsPayload, ModelResult, TrainSummary } from '@/features/ml/train/types';

/**
 * Optional analyses attached to a run after training — each holds the LATEST
 * outcome of its kind (running a second tuning replaces the first). Metrics
 * and summaries only, never the source data.
 */
/** Persisted batch score: the numbers survive, the row-level CSV does not. */
export type BatchScoreArtifact = Omit<BatchScore, 'csv' | 'preview'>;

export interface RunArtifacts {
  tuning?: TuneOutcome;
  /** Shapley explanation of the last explained what-if row. */
  explanation?: ShapleyExplanation;
  exploration?: ExplorationPayload;
  forecast?: ForecastPayload;
  batchScore?: BatchScoreArtifact;
}

/**
 * A completed run as persisted locally and as shared through links:
 * configuration, metrics and insights — never the source data.
 */
export interface RunRecord {
  id?: number;
  name: string;
  createdAt: number;
  dataset: { name: string; rowCount: number; columnCount: number };
  target: string;
  taskType: TaskType;
  seed: number;
  results: ModelResult[];
  summary: TrainSummary;
  /** Insights of the winning model at save time. */
  insights: InsightsPayload;
  /** Analyses that joined the run after training (v13+ records). */
  artifacts?: RunArtifacts;
}

/** v1 links carried no artifacts; v2 added them. Both still decode. */
export interface SharePayload extends Omit<RunRecord, 'id'> {
  v: 1 | 2;
}

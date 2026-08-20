import type { TaskType } from '@/features/ml/data/types';
import type { InsightsPayload, ModelResult, TrainSummary } from '@/features/ml/train/types';

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
}

export interface SharePayload extends Omit<RunRecord, 'id'> {
  v: 1;
}

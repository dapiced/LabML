import type { TaskInfo, TaskType } from '@/features/ml/data/types';

export type ModelKey =
  'baseline' | 'linear' | 'logistic' | 'knn' | 'naiveBayes' | 'tree' | 'forest';

export interface TrainConfig {
  target: string;
  /** Feature columns to use (already filtered by the UI's exclusions). */
  features: string[];
  seed: number;
  testRatio: number;
}

/** Metric values per model; keys depend on the task type. */
export type MetricMap = Partial<
  Record<
    'accuracy' | 'precision' | 'recall' | 'f1' | 'auc' | 'logLoss' | 'rmse' | 'mae' | 'r2',
    number
  >
>;

export interface ModelResult {
  key: ModelKey;
  ok: boolean;
  error?: string;
  metrics: MetricMap;
  /** Value of the primary metric (accuracy or rmse) used for ranking. */
  primary: number;
  trainMs: number;
  inferP50Ms: number;
  inferP95Ms: number;
}

export interface TrainSummary {
  task: TaskInfo;
  taskType: TaskType;
  seed: number;
  trainRows: number;
  testRows: number;
  /** Expanded feature count after encoding. */
  featureCount: number;
  /** Source columns actually used. */
  featureColumns: string[];
  /** Source columns skipped because their type is not trainable yet (text/date). */
  skippedColumns: string[];
  totalMs: number;
}

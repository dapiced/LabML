import type { TaskInfo, TaskType } from '@/features/ml/data/types';

export type ModelKey =
  'baseline' | 'linear' | 'logistic' | 'knn' | 'naiveBayes' | 'tree' | 'forest' | 'gbdt' | 'mlp';

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

export interface InsightsPayload {
  model: ModelKey;
  /** Class labels, classification only. */
  classes?: string[];
  /** Confusion matrix indexed [true][predicted], classification only. */
  confusion?: number[][];
  /** ROC curve, binary classification with probabilistic models only. */
  roc?: { points: { fpr: number; tpr: number }[]; auc: number };
  /** (actual, predicted) sample, regression only. */
  scatter?: { actual: number; predicted: number }[];
  /** Residuals histogram, regression only. */
  residuals?: { counts: number[]; min: number; max: number };
  /** Permutation importance per source column, sorted descending. */
  importance: { column: string; value: number }[];
  /**
   * Signed word effects inside text columns (V24): the average shift of the
   * answer when that word is erased from the reviews containing it, biggest
   * magnitude first. Absent without a text column, and on multiclass tasks —
   * there is no single axis to project the shift onto.
   */
  words?: { column: string; term: string; effect: number; rows: number }[];
  /**
   * Partial dependence of the prediction on the top numeric columns
   * (binary classification: mean probability of the positive class;
   * regression: mean prediction). x is in the column's original scale.
   */
  pdp?: { column: string; points: { x: number; y: number }[] }[];
}

export interface WhatIfResult {
  model: ModelKey;
  /** Predicted class label or formatted numeric value. */
  prediction: string;
  /** Class probabilities, when the model provides them. */
  probabilities?: { label: string; p: number }[];
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
  /** Source columns skipped for their type — dates and identifiers (V24 made text trainable). */
  skippedColumns: string[];
  totalMs: number;
}

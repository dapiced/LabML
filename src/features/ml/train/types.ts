import type { TaskInfo, TaskType } from '@/features/ml/data/types';

export type ModelKey =
  'baseline' | 'linear' | 'logistic' | 'knn' | 'naiveBayes' | 'tree' | 'forest' | 'gbdt' | 'mlp';

export interface TrainConfig {
  target: string;
  /** Feature columns to use (already filtered by the UI's exclusions). */
  features: string[];
  seed: number;
  testRatio: number;
  /**
   * V35: how rows are assigned to the splits. Absent = seeded random
   * (stratified on classification). 'chronological' orders rows by the named
   * date column — oldest train, newest test — because a random split on dated
   * data puts the future in training. 'group' keeps every row sharing the
   * named column's value on the same side — the same customer in both train
   * and test is the same leak.
   */
  split?: SplitChoice;
}

export interface SplitChoice {
  mode: 'chronological' | 'group';
  column: string;
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
  /**
   * V25: rows this model actually trained on. Slow families train on an
   * ANNOUNCED seeded sample of the train split (see MODEL_TRAIN_CAPS) —
   * the leaderboard shows this number whenever it is below trainRows.
   * Absent on runs stored before V25 and on failed models.
   */
  trainedRows?: number;
  /**
   * V35: the same metrics on the validation split. When present, the
   * leaderboard ranks and crowns on THESE — taking the maximum of nine test
   * scores biased the headline number upward — and reports the champion's
   * test score next to it, gap included. Absent on runs stored before V35
   * and on datasets too small for a third split (refused by name).
   */
  valMetrics?: MetricMap;
  /** Primary validation metric (accuracy or RMSE); see valMetrics. */
  valPrimary?: number;
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
   * V35: the word-effect method could not measure anything and says so.
   * 'saturated' = the model answers with only one or two distinct
   * probabilities (Gaussian Naive Bayes on many TF-IDF features does), so
   * every occlusion shifts it by exactly zero. Silence would read as
   * "no word matters", which is a different — and false — statement.
   */
  wordsRefused?: 'saturated';
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
  /**
   * V25: usable rows in the dataset when it exceeded the announced global cap
   * (100 000) and train/test were drawn from a seeded stratified sample.
   * Absent when every usable row was used — sampling is never silent.
   */
  sampledFrom?: number;
  /**
   * V35: rows held out for model selection. Absent when the dataset was too
   * small for a third split (refused by name — the leaderboard then ranks on
   * test, as before V35, and says nothing it cannot back).
   */
  validationRows?: number;
  /** V35: non-random split, when one was chosen — always announced. */
  split?: {
    mode: 'chronological' | 'group';
    column: string;
    /** Rows excluded because the split column had no usable value there. */
    dropped?: number;
  };
  /**
   * V35: single columns that predict the target (almost) alone, measured by a
   * one-column stump fitted on train and scored on the held-out selection
   * split. A lone column at 99% is nearly always target leakage — shown as a
   * warning, never as a victory.
   */
  leakWarnings?: { column: string; score: number }[];
}

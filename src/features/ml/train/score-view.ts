/** Shared display logic for the batch-score comparison tables. */
import type { MetricMap } from '@/features/ml/train/types';

export type MetricKey = keyof MetricMap;

/** Comparison rows in display order, with each metric's improvement direction. */
export const METRIC_ROWS: { key: MetricKey; higherIsBetter: boolean }[] = [
  { key: 'accuracy', higherIsBetter: true },
  { key: 'f1', higherIsBetter: true },
  { key: 'auc', higherIsBetter: true },
  { key: 'logLoss', higherIsBetter: false },
  { key: 'rmse', higherIsBetter: false },
  { key: 'mae', higherIsBetter: false },
  { key: 'r2', higherIsBetter: true },
];

export function metricDelta(
  key: MetricKey,
  test: number,
  batch: number,
): { value: number; better: boolean } {
  const row = METRIC_ROWS.find((entry) => entry.key === key);
  const value = batch - test;
  return { value, better: row?.higherIsBetter !== false ? value >= 0 : value <= 0 };
}

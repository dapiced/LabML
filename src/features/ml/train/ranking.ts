/**
 * V35: one place decides how models are ranked and who is crowned.
 *
 * Before V35 every surface sorted by `primary` — the metric computed on the
 * test set — and crowned `sorted[0]`. Taking the maximum of nine draws on a
 * few hundred test rows biases the headline figure upward. When a run carries
 * validation scores, ranking and crowning happen on THOSE, and the test score
 * is what gets reported for the champion, gap included. Runs stored before
 * V35 have no validation scores and keep their historical ranking.
 *
 * V36: the metric itself is now a choice. Accuracy and RMSE were imposed,
 * which is the wrong criterion on an imbalanced problem — a model that never
 * predicts the rare class can top an accuracy ranking and be useless. Pass a
 * `metric` to rank on F1, recall, precision or ROC-AUC instead; the ranking
 * genuinely changes, which is the point.
 */
import type { TaskType } from '@/features/ml/data/types';
import type { MetricMap, ModelResult, RankingMetric } from '@/features/ml/train/types';

/** For each rankable metric, whether a higher value is better. */
export const METRIC_DIRECTION: Record<RankingMetric, 'higher' | 'lower'> = {
  accuracy: 'higher',
  f1: 'higher',
  recall: 'higher',
  precision: 'higher',
  auc: 'higher',
  r2: 'higher',
  rmse: 'lower',
  mae: 'lower',
};

/** The metrics offered for ranking, per task — only ones the run computes. */
export function rankableMetrics(taskType: TaskType): RankingMetric[] {
  if (taskType === 'regression') return ['rmse', 'mae', 'r2'];
  const base: RankingMetric[] = ['accuracy', 'f1', 'recall', 'precision'];
  return taskType === 'binary' ? [...base, 'auc'] : base;
}

/** The default: what `primary` already holds, so nothing changes silently. */
export function defaultMetric(taskType: TaskType): RankingMetric {
  return taskType === 'regression' ? 'rmse' : 'accuracy';
}

/** Metrics to read: validation when the run has them (V35), test otherwise. */
function metricsOf(result: ModelResult): MetricMap {
  return result.valMetrics ?? result.metrics;
}

/**
 * The value a model is ranked on. Without a metric this is the historical
 * `primary` (validation when present) — so stored runs keep their order.
 */
export function rankingValue(result: ModelResult, metric?: RankingMetric): number {
  if (metric === undefined) return result.valPrimary ?? result.primary;
  const value = metricsOf(result)[metric];
  if (value !== undefined && !Number.isNaN(value)) return value;
  // A model that cannot produce the chosen metric (no probabilities → no AUC)
  // sorts last rather than being dropped: it still ran, and the table says so.
  return METRIC_DIRECTION[metric] === 'higher'
    ? Number.NEGATIVE_INFINITY
    : Number.POSITIVE_INFINITY;
}

/** Successful results, best first, on the chosen metric's own direction. */
export function sortResults(
  results: ModelResult[],
  taskType: TaskType,
  metric?: RankingMetric,
): ModelResult[] {
  const higherWins =
    metric === undefined ? taskType !== 'regression' : METRIC_DIRECTION[metric] === 'higher';
  return results
    .filter((r) => r.ok)
    .sort((a, b) => {
      const av = rankingValue(a, metric);
      const bv = rankingValue(b, metric);
      const delta = higherWins ? bv - av : av - bv;
      // Ties resolve by key so the order is stable across renders and runs.
      return delta !== 0 ? delta : a.key.localeCompare(b.key);
    });
}

export function bestResult(
  results: ModelResult[],
  taskType: TaskType,
  metric?: RankingMetric,
): ModelResult | null {
  return sortResults(results, taskType, metric)[0] ?? null;
}

/**
 * The champion's selection-vs-test gap — the most useful lesson the lab can
 * teach: the score a model was chosen on is always a little optimistic.
 * Null when the run carries no validation scores.
 */
export function championGap(
  results: ModelResult[],
  taskType: TaskType,
  metric?: RankingMetric,
): { model: ModelResult; val: number; test: number; gap: number } | null {
  const best = bestResult(results, taskType, metric);
  if (!best || best.valPrimary === undefined) return null;
  if (metric === undefined) {
    return {
      model: best,
      val: best.valPrimary,
      test: best.primary,
      gap: best.primary - best.valPrimary,
    };
  }
  const val = best.valMetrics?.[metric];
  const test = best.metrics[metric];
  if (val === undefined || test === undefined) return null;
  return { model: best, val, test, gap: test - val };
}

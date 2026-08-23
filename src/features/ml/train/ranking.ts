/**
 * V35: one place decides how models are ranked and who is crowned.
 *
 * Before V35 every surface sorted by `primary` — the metric computed on the
 * test set — and crowned `sorted[0]`. Taking the maximum of nine draws on a
 * few hundred test rows biases the headline figure upward. When a run carries
 * validation scores, ranking and crowning happen on THOSE, and the test score
 * is what gets reported for the champion, gap included. Runs stored before
 * V35 have no validation scores and keep their historical ranking.
 */
import type { TaskType } from '@/features/ml/data/types';
import type { ModelResult } from '@/features/ml/train/types';

/** The value a model is ranked on: validation when present, test otherwise. */
export function rankingValue(result: ModelResult): number {
  return result.valPrimary ?? result.primary;
}

/** Successful results, best first (accuracy: higher wins; RMSE: lower wins). */
export function sortResults(results: ModelResult[], taskType: TaskType): ModelResult[] {
  const isClassification = taskType !== 'regression';
  return results
    .filter((r) => r.ok)
    .sort((a, b) =>
      isClassification ? rankingValue(b) - rankingValue(a) : rankingValue(a) - rankingValue(b),
    );
}

export function bestResult(results: ModelResult[], taskType: TaskType): ModelResult | null {
  return sortResults(results, taskType)[0] ?? null;
}

/**
 * The champion's selection-vs-test gap — the most useful lesson the lab can
 * teach: the score a model was chosen on is always a little optimistic.
 * Null when the run carries no validation scores.
 */
export function championGap(
  results: ModelResult[],
  taskType: TaskType,
): { model: ModelResult; val: number; test: number; gap: number } | null {
  const best = bestResult(results, taskType);
  if (!best || best.valPrimary === undefined) return null;
  return {
    model: best,
    val: best.valPrimary,
    test: best.primary,
    gap: best.primary - best.valPrimary,
  };
}

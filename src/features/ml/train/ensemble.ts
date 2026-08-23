/**
 * V36: an ensemble of the models already trained.
 *
 * The cheapest real gain in the zoo: the top families are already fitted and
 * sitting in worker memory, so averaging them costs one more pass over the
 * test set and nothing else. Typically 1–3 points, and it teaches why
 * ensembling works — independent mistakes cancel, shared mistakes do not.
 *
 * Two honest rules:
 * - The **baseline is never a member**. Averaging a constant predictor in
 *   drags the ensemble toward the majority class; it is a reference, not a
 *   candidate.
 * - Members are picked by the SAME ranking rule as the leaderboard (V35:
 *   validation when the run has it), so the ensemble is not quietly selected
 *   on the reporting set.
 *
 * Classification prefers members that can express a confidence: the top three
 * PROBABILISTIC models are taken first, and the vote path is used only when
 * fewer than two of those exist. That is not cosmetic — an ensemble without
 * probabilities cannot be read by the threshold, calibration or word-effect
 * panels, so letting one non-probabilistic member drag the whole ensemble
 * down to a bare vote would quietly close three panels on the champion.
 * Ties in a vote go to the leader's answer — deterministic, never a coin
 * flip. Regression averages predictions.
 */
import { sortResults } from '@/features/ml/train/ranking';
import type { TaskType } from '@/features/ml/data/types';
import type { TrainedModel } from '@/features/ml/train/models';
import type { ModelKey, ModelResult } from '@/features/ml/train/types';

/** How many models the ensemble averages. Three is where the gain plateaus. */
export const ENSEMBLE_SIZE = 3;
/** Below this many real (non-baseline) models, an ensemble is meaningless. */
export const ENSEMBLE_MIN_MEMBERS = 2;

export type EnsembleMethod = 'probability' | 'vote' | 'mean';

export interface EnsemblePlan {
  members: ModelKey[];
  method: EnsembleMethod;
}

/**
 * Which models the ensemble would average, and how. Null when there are not
 * enough real candidates — refused by name rather than built from one model.
 */
export function planEnsemble(
  results: ModelResult[],
  taskType: TaskType,
  models: Map<ModelKey, TrainedModel>,
): EnsemblePlan | null {
  const candidates = sortResults(results, taskType).filter(
    (r) => r.key !== 'baseline' && models.has(r.key),
  );
  if (candidates.length < ENSEMBLE_MIN_MEMBERS) return null;

  if (taskType === 'regression') {
    return { members: candidates.slice(0, ENSEMBLE_SIZE).map((r) => r.key), method: 'mean' };
  }

  // Probabilistic members first — see the note above on why this matters.
  const probabilistic = candidates.filter(
    (r) => typeof models.get(r.key)?.predictProba === 'function',
  );
  if (probabilistic.length >= ENSEMBLE_MIN_MEMBERS) {
    return {
      members: probabilistic.slice(0, ENSEMBLE_SIZE).map((r) => r.key),
      method: 'probability',
    };
  }
  return { members: candidates.slice(0, ENSEMBLE_SIZE).map((r) => r.key), method: 'vote' };
}

/** Builds the ensemble as a TrainedModel, so every panel can score it as one. */
export function buildEnsemble(
  plan: EnsemblePlan,
  models: Map<ModelKey, TrainedModel>,
  classCount: number,
): TrainedModel {
  const members = plan.members.map((key) => models.get(key)!);

  if (plan.method === 'mean') {
    return {
      predict: (X) => {
        const columns = members.map((m) => m.predict(X));
        return X.map((_, i) => columns.reduce((a, col) => a + col[i], 0) / members.length);
      },
    };
  }

  if (plan.method === 'probability') {
    const proba = (X: number[][]): number[][] => {
      const stacks = members.map((m) => m.predictProba!(X));
      return X.map((_, i) => {
        const summed = new Array<number>(classCount).fill(0);
        for (const stack of stacks) {
          const row = stack[i];
          for (let c = 0; c < classCount; c++) summed[c] += row[c] ?? 0;
        }
        return summed.map((v) => v / members.length);
      });
    };
    return {
      predict: (X) => proba(X).map((p) => p.indexOf(Math.max(...p))),
      predictProba: proba,
    };
  }

  // Majority vote; ties fall to the leader — deterministic, never a coin flip.
  return {
    predict: (X) => {
      const columns = members.map((m) => m.predict(X));
      return X.map((_, i) => {
        const tally = new Map<number, number>();
        for (const col of columns) tally.set(col[i], (tally.get(col[i]) ?? 0) + 1);
        let best = columns[0][i];
        let bestCount = -1;
        for (const [label, count] of tally) {
          if (count > bestCount) {
            best = label;
            bestCount = count;
          }
        }
        const leaderAnswer = columns[0][i];
        return (tally.get(leaderAnswer) ?? 0) === bestCount ? leaderAnswer : best;
      });
    },
  };
}

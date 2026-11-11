/**
 * Assembles the V16 imbalance bundle for one probabilistic model: the held-out
 * (probability, label) pairs plus the PR and calibration curves computed from
 * them. The UI re-derives threshold metrics locally from the pairs with the
 * pure functions — no worker round-trip per slider move.
 *
 * V36 opened the multiclass case V16 set aside. The generalisation that is
 * actually defensible is ONE-VS-REST: pick a class, score it against all the
 * others, and read the same curves. What it is NOT is a complete multiclass
 * decision rule — two classes can both clear their thresholds, and nothing
 * here says which wins. The panel states that rather than implying a rule it
 * does not provide.
 *
 * V53: the cost-optimal threshold is a choice, and the panel used to make it
 * on the very pairs that then graded it. Measured over ten seeds and the six
 * probabilistic models: the cost shown at that cut was 33 to 60 % below what a cut picked
 * on validation costs on test (fraud demo), 12 to 16 % on titanic. The bundle
 * now carries the validation pairs too, and `suggestThreshold` reads only
 * those: validation chooses, test measures, the rule V45 already follows for
 * multiclass decisions.
 */
import {
  bestThresholdByCost,
  calibrationCurve,
  prCurve,
  type CalibrationCurve,
  type PrCurve,
} from '@/features/ml/train/threshold';
import type { TrainArtifacts } from '@/features/ml/train/trainer';
import type { ModelKey } from '@/features/ml/train/types';

export interface ThresholdAnalysis {
  model: ModelKey;
  /** The class whose probability is thresholded. */
  positiveClass: string;
  /** Test-set pairs: [probability of the positive class, actual 0/1]. */
  pairs: [number, number][];
  /**
   * V53: the same pairs on the validation split, the only ones a threshold
   * may be picked on. Absent when the run has no validation split.
   */
  validationPairs?: [number, number][];
  pr: PrCurve;
  calibration: CalibrationCurve;
  /**
   * V36: index of the analysed class, and the full class list, so the UI can
   * offer the choice. Present on multiclass runs; absent on binary, where
   * there is exactly one meaningful positive class.
   */
  oneVsRest?: { classIndex: number; classes: string[] };
}

export function analyzeThresholds(
  artifacts: TrainArtifacts,
  modelKey: ModelKey,
  /** V36: which class to read one-vs-rest. Ignored on binary runs. */
  focusClass?: number,
): ThresholdAnalysis | null {
  const model = artifacts.models.get(modelKey);
  if (!model?.predictProba) return null;
  if (!artifacts.isClassification || artifacts.classes.length < 2) return null;

  const multiclass = artifacts.classes.length > 2;
  // Binary keeps its historical reading: classes[1] is the positive class.
  const index = multiclass
    ? Math.min(Math.max(focusClass ?? 0, 0), artifacts.classes.length - 1)
    : 1;

  const binarise = (labels: number[]) =>
    multiclass ? labels.map((label) => (label === index ? 1 : 0)) : labels;

  const p = model.predictProba(artifacts.testX).map((row) => row[index] ?? 0);
  const y = binarise(artifacts.testY);

  const pr = prCurve(y, p);
  if (!pr) return null;

  const validationY = binarise(artifacts.validationY);
  const validationPairs: [number, number][] | null =
    artifacts.validationX.length > 0
      ? model.predictProba(artifacts.validationX).map((row, i) => [row[index] ?? 0, validationY[i]])
      : null;

  return {
    model: modelKey,
    positiveClass: artifacts.classes[index],
    pairs: y.map((label, i) => [p[i], label]),
    ...(validationPairs !== null && { validationPairs }),
    pr,
    calibration: calibrationCurve(y, p),
    ...(multiclass && { oneVsRest: { classIndex: index, classes: artifacts.classes } }),
  };
}

/**
 * V53: the threshold minimising the user's costs, picked on VALIDATION so the
 * test metrics shown beside it stay a measurement. Null is a refusal, not a
 * fallback: with no validation split, or one holding a single class, any cut
 * would have to come from the test pairs, and the panel then offers none.
 */
export function suggestThreshold(
  analysis: ThresholdAnalysis,
  costFp: number,
  costFn: number,
): number | null {
  const pairs = analysis.validationPairs;
  if (!pairs || pairs.length === 0) return null;
  const y = pairs.map(([, label]) => label);
  const positives = y.reduce((a, v) => a + v, 0);
  if (positives === 0 || positives === y.length) return null;
  const p = pairs.map(([proba]) => proba);
  return bestThresholdByCost(y, p, costFp, costFn).threshold;
}

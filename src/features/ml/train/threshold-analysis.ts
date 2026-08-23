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
 */
import {
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

  const p = model.predictProba(artifacts.testX).map((row) => row[index] ?? 0);
  const y = multiclass
    ? artifacts.testY.map((label) => (label === index ? 1 : 0))
    : artifacts.testY;

  const pr = prCurve(y, p);
  if (!pr) return null;

  return {
    model: modelKey,
    positiveClass: artifacts.classes[index],
    pairs: y.map((label, i) => [p[i], label]),
    pr,
    calibration: calibrationCurve(y, p),
    ...(multiclass && { oneVsRest: { classIndex: index, classes: artifacts.classes } }),
  };
}

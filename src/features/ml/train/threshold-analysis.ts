/**
 * Assembles the V16 imbalance bundle for one binary probabilistic model:
 * the held-out (probability, label) pairs plus the PR and calibration curves
 * computed from them. The UI re-derives threshold metrics locally from the
 * pairs with the pure functions — no worker round-trip per slider move.
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
  /** The class whose probability is thresholded (classes[1]). */
  positiveClass: string;
  /** Test-set pairs: [probability of the positive class, actual 0/1]. */
  pairs: [number, number][];
  pr: PrCurve;
  calibration: CalibrationCurve;
}

export function analyzeThresholds(
  artifacts: TrainArtifacts,
  modelKey: ModelKey,
): ThresholdAnalysis | null {
  const model = artifacts.models.get(modelKey);
  if (!model?.predictProba) return null;
  if (!artifacts.isClassification || artifacts.classes.length !== 2) return null;

  const p = model.predictProba(artifacts.testX).map((row) => row[1] ?? 0);
  const pr = prCurve(artifacts.testY, p);
  if (!pr) return null;

  return {
    model: modelKey,
    positiveClass: artifacts.classes[1],
    pairs: artifacts.testY.map((label, i) => [p[i], label]),
    pr,
    calibration: calibrationCurve(artifacts.testY, p),
  };
}

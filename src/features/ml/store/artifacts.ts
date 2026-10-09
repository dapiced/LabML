import { thresholdMetrics } from '@/features/ml/train/threshold';
import type { ThresholdAnalysis } from '@/features/ml/train/threshold-analysis';

/** The persisted form of the analysis + the user's current cut. */
export function thresholdArtifact(
  analysis: ThresholdAnalysis,
  choice: { threshold: number; costFp: number; costFn: number },
) {
  const y = analysis.pairs.map(([, label]) => label);
  const p = analysis.pairs.map(([proba]) => proba);
  return {
    model: analysis.model,
    positiveClass: analysis.positiveClass,
    positiveRate: analysis.pr.positiveRate,
    averagePrecision: analysis.pr.averagePrecision,
    brier: analysis.calibration.brier,
    prPoints: analysis.pr.points,
    calibrationBins: analysis.calibration.bins,
    chosen: {
      ...thresholdMetrics(y, p, choice.threshold, choice.costFp, choice.costFn),
      costFp: choice.costFp,
      costFn: choice.costFn,
    },
  };
}

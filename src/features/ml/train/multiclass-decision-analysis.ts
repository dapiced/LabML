import {
  evaluateMulticlassPolicy,
  type MulticlassDecisionMetrics,
  type MulticlassDecisionPolicy,
} from '@/features/ml/train/multiclass-decision';
import type { TrainArtifacts } from '@/features/ml/train/trainer';
import type { ModelKey } from '@/features/ml/train/types';

export interface MulticlassDecisionAnalysis {
  model: ModelKey;
  classes: string[];
  validationProbabilities: number[][];
  validationLabels: number[];
}

export interface MulticlassDecisionTestResult {
  policy: MulticlassDecisionPolicy;
  metrics: MulticlassDecisionMetrics;
  exploratory: boolean;
}

export function analyzeMulticlassDecision(
  artifacts: TrainArtifacts,
  modelKey: ModelKey,
): MulticlassDecisionAnalysis | null {
  const model = artifacts.models.get(modelKey);
  if (
    !artifacts.isClassification ||
    artifacts.classes.length <= 2 ||
    artifacts.validationX.length === 0 ||
    !model?.predictProba
  ) {
    return null;
  }

  return {
    model: modelKey,
    classes: [...artifacts.classes],
    validationProbabilities: model.predictProba(artifacts.validationX),
    validationLabels: [...artifacts.validationY],
  };
}

export function testMulticlassDecision(
  artifacts: TrainArtifacts,
  modelKey: ModelKey,
  policy: MulticlassDecisionPolicy,
  exploratory: boolean,
): MulticlassDecisionTestResult {
  const model = artifacts.models.get(modelKey);
  if (!model?.predictProba) throw new Error('model-not-found');

  return {
    policy,
    metrics: evaluateMulticlassPolicy(artifacts.testY, model.predictProba(artifacts.testX), policy),
    exploratory,
  };
}

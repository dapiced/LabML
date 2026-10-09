export interface MulticlassDecisionPolicy {
  thresholds: number[];
}

export interface MulticlassDecision {
  rawClass: number;
  policyClass: number | null;
  status: 'decided' | 'abstained';
}

export interface ClassDecisionMetrics {
  classIndex: number;
  support: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface MulticlassDecisionMetrics {
  rows: number;
  decided: number;
  abstained: number;
  coverage: number;
  accuracy: number;
  decidedAccuracy: number;
  macroPrecision: number;
  macroRecall: number;
  macroF1: number;
  perClass: ClassDecisionMetrics[];
}

function hasValidThresholds(policy: MulticlassDecisionPolicy): boolean {
  return (
    policy.thresholds.length > 0 &&
    policy.thresholds.every(
      (threshold) => Number.isFinite(threshold) && threshold >= 0 && threshold <= 1,
    )
  );
}

function validatePolicy(probabilities: number[], policy: MulticlassDecisionPolicy): void {
  if (probabilities.length !== policy.thresholds.length || !hasValidThresholds(policy)) {
    throw new Error('bad-policy');
  }
}

export function applyMulticlassPolicy(
  probabilities: number[],
  policy: MulticlassDecisionPolicy,
): MulticlassDecision {
  validatePolicy(probabilities, policy);

  let rawClass = 0;
  let policyClass: number | null = null;
  let bestExcess = Number.NEGATIVE_INFINITY;

  for (let classIndex = 0; classIndex < probabilities.length; classIndex++) {
    const probability = probabilities[classIndex];
    const threshold = policy.thresholds[classIndex];

    if (probability > probabilities[rawClass]) rawClass = classIndex;
    if (probability < threshold) continue;

    const excess =
      probability === 1 && threshold === 1 ? 1 : (probability - threshold) / (1 - threshold);
    if (excess > bestExcess) {
      bestExcess = excess;
      policyClass = classIndex;
    }
  }

  return policyClass === null
    ? { rawClass, policyClass, status: 'abstained' }
    : { rawClass, policyClass, status: 'decided' };
}

export function evaluateMulticlassPolicy(
  labels: number[],
  probabilities: number[][],
  policy: MulticlassDecisionPolicy,
): MulticlassDecisionMetrics {
  if (labels.length !== probabilities.length || !hasValidThresholds(policy)) {
    throw new Error('bad-policy');
  }

  const classCount = policy.thresholds.length;
  const support = new Array<number>(classCount).fill(0);
  const truePositives = new Array<number>(classCount).fill(0);
  const falsePositives = new Array<number>(classCount).fill(0);
  const falseNegatives = new Array<number>(classCount).fill(0);
  let decided = 0;
  let correct = 0;

  for (let row = 0; row < labels.length; row++) {
    const label = labels[row];
    if (!Number.isInteger(label) || label < 0 || label >= classCount) throw new Error('bad-policy');

    support[label] += 1;
    const decision = applyMulticlassPolicy(probabilities[row], policy);
    if (decision.policyClass === null) {
      falseNegatives[label] += 1;
      continue;
    }

    decided += 1;
    if (decision.policyClass === label) {
      correct += 1;
      truePositives[label] += 1;
    } else {
      falsePositives[decision.policyClass] += 1;
      falseNegatives[label] += 1;
    }
  }

  const perClass = support.map((classSupport, classIndex) => {
    const tp = truePositives[classIndex];
    const fp = falsePositives[classIndex];
    const fn = falseNegatives[classIndex];
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    return { classIndex, support: classSupport, precision, recall, f1 };
  });
  // V50: the same rule as `macroPrf` and scikit-learn — the macro average
  // runs over the classes present among the true labels or the decisions.
  const present = perClass.filter(
    (metrics) => metrics.support > 0 || falsePositives[metrics.classIndex] > 0,
  );
  const sum = (field: 'precision' | 'recall' | 'f1') =>
    present.length === 0
      ? Number.NaN
      : present.reduce((total, metrics) => total + metrics[field], 0) / present.length;
  const rows = labels.length;

  return {
    rows,
    decided,
    abstained: rows - decided,
    coverage: rows === 0 ? 0 : decided / rows,
    accuracy: rows === 0 ? 0 : correct / rows,
    decidedAccuracy: decided === 0 ? 0 : correct / decided,
    macroPrecision: sum('precision'),
    macroRecall: sum('recall'),
    macroF1: sum('f1'),
    perClass,
  };
}

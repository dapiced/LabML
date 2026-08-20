const EPSILON = 1e-15;

export function accuracy(yTrue: number[], yPred: number[]): number {
  let correct = 0;
  for (let i = 0; i < yTrue.length; i++) if (yTrue[i] === yPred[i]) correct += 1;
  return yTrue.length === 0 ? 0 : correct / yTrue.length;
}

/** Macro-averaged precision, recall and F1 over the given number of classes. */
export function macroPrf(
  yTrue: number[],
  yPred: number[],
  classCount: number,
): { precision: number; recall: number; f1: number } {
  let precisionSum = 0;
  let recallSum = 0;
  let f1Sum = 0;
  for (let c = 0; c < classCount; c++) {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (let i = 0; i < yTrue.length; i++) {
      const isTrue = yTrue[i] === c;
      const isPred = yPred[i] === c;
      if (isTrue && isPred) tp += 1;
      else if (!isTrue && isPred) fp += 1;
      else if (isTrue && !isPred) fn += 1;
    }
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    precisionSum += precision;
    recallSum += recall;
    f1Sum += f1;
  }
  return {
    precision: precisionSum / classCount,
    recall: recallSum / classCount,
    f1: f1Sum / classCount,
  };
}

/** Cross-entropy over predicted class probabilities (n × k), clipped for stability. */
export function logLoss(yTrue: number[], probabilities: number[][]): number {
  let sum = 0;
  for (let i = 0; i < yTrue.length; i++) {
    const p = Math.min(1 - EPSILON, Math.max(EPSILON, probabilities[i][yTrue[i]] ?? EPSILON));
    sum += -Math.log(p);
  }
  return yTrue.length === 0 ? 0 : sum / yTrue.length;
}

/**
 * Binary ROC-AUC from positive-class scores, computed rank-based
 * (Mann–Whitney U) with average ranks on ties.
 */
export function rocAuc(yTrue: number[], scores: number[]): number | null {
  const order = yTrue.map((_, i) => i).sort((a, b) => scores[a] - scores[b]);
  const ranks = new Array<number>(yTrue.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && scores[order[j + 1]] === scores[order[i]]) j += 1;
    const averageRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k]] = averageRank;
    i = j + 1;
  }
  let positives = 0;
  let rankSum = 0;
  for (let k = 0; k < yTrue.length; k++) {
    if (yTrue[k] === 1) {
      positives += 1;
      rankSum += ranks[k];
    }
  }
  const negatives = yTrue.length - positives;
  if (positives === 0 || negatives === 0) return null;
  return (rankSum - (positives * (positives + 1)) / 2) / (positives * negatives);
}

export function rmse(yTrue: number[], yPred: number[]): number {
  let sum = 0;
  for (let i = 0; i < yTrue.length; i++) sum += (yTrue[i] - yPred[i]) ** 2;
  return yTrue.length === 0 ? 0 : Math.sqrt(sum / yTrue.length);
}

export function mae(yTrue: number[], yPred: number[]): number {
  let sum = 0;
  for (let i = 0; i < yTrue.length; i++) sum += Math.abs(yTrue[i] - yPred[i]);
  return yTrue.length === 0 ? 0 : sum / yTrue.length;
}

export function r2(yTrue: number[], yPred: number[]): number {
  const mean = yTrue.reduce((a, v) => a + v, 0) / (yTrue.length || 1);
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < yTrue.length; i++) {
    ssRes += (yTrue[i] - yPred[i]) ** 2;
    ssTot += (yTrue[i] - mean) ** 2;
  }
  if (ssTot === 0) return ssRes === 0 ? 1 : 0;
  return 1 - ssRes / ssTot;
}

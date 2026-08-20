import { describe, expect, it } from 'vitest';
import { accuracy, logLoss, macroPrf, mae, r2, rmse, rocAuc } from '@/features/ml/train/metrics';

describe('classification metrics', () => {
  it('accuracy counts exact matches', () => {
    expect(accuracy([0, 1, 1, 0], [0, 1, 0, 0])).toBe(0.75);
  });

  it('macro precision/recall/F1 on a hand-computed case', () => {
    // class 0: P=0.5 R=0.5 F1=0.5 · class 1: P=2/3 R=2/3 F1=2/3 → macro 7/12
    const { precision, recall, f1 } = macroPrf([0, 0, 1, 1, 1], [0, 1, 1, 1, 0], 2);
    expect(precision).toBeCloseTo(7 / 12, 10);
    expect(recall).toBeCloseTo(7 / 12, 10);
    expect(f1).toBeCloseTo(7 / 12, 10);
  });

  it('log-loss matches the hand-computed cross-entropy', () => {
    const value = logLoss(
      [0, 1],
      [
        [0.8, 0.2],
        [0.3, 0.7],
      ],
    );
    expect(value).toBeCloseTo(-(Math.log(0.8) + Math.log(0.7)) / 2, 12);
  });

  it('ROC-AUC matches the classic reference case', () => {
    // Same example as scikit-learn's roc_auc_score docstring: 0.75.
    expect(rocAuc([0, 0, 1, 1], [0.1, 0.4, 0.35, 0.8])).toBeCloseTo(0.75, 12);
    expect(rocAuc([0, 0, 1, 1], [0.1, 0.2, 0.8, 0.9])).toBe(1);
    expect(rocAuc([0, 1, 0, 1], [0.5, 0.5, 0.5, 0.5])).toBeCloseTo(0.5, 12);
    expect(rocAuc([0, 0], [0.1, 0.2])).toBeNull();
  });
});

describe('regression metrics', () => {
  it('rmse, mae and r2 on a hand-computed case', () => {
    expect(rmse([1, 2, 3], [2, 2, 2])).toBeCloseTo(Math.sqrt(2 / 3), 12);
    expect(mae([1, 2, 3], [2, 2, 2])).toBeCloseTo(2 / 3, 12);
    // Predicting the mean gives exactly R² = 0; a perfect fit gives 1.
    expect(r2([1, 2, 3], [2, 2, 2])).toBeCloseTo(0, 12);
    expect(r2([1, 2, 3], [1, 2, 3])).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import {
  bestThresholdByCost,
  calibrationCurve,
  prCurve,
  thresholdMetrics,
} from '@/features/ml/train/threshold';

// Four rows, hand-checkable: probabilities 0.9, 0.8, 0.4, 0.1.
const Y = [1, 0, 1, 0];
const P = [0.9, 0.8, 0.4, 0.1];

describe('prCurve', () => {
  it('matches the hand-computed curve and Average Precision', () => {
    const curve = prCurve(Y, P)!;
    // Thresholds 0.9 → (R 0.5, P 1) · 0.8 → (0.5, 0.5) · 0.4 → (1, 2/3) · 0.1 → (1, 0.5)
    expect(curve.points.map((pt) => [pt.recall, +pt.precision.toFixed(4)])).toEqual([
      [0.5, 1],
      [0.5, 0.5],
      [1, 0.6667],
      [1, 0.5],
    ]);
    // AP = 0.5·1 + 0·0.5 + 0.5·(2/3) + 0·0.5 = 0.8333…
    expect(curve.averagePrecision).toBeCloseTo(0.8333, 3);
    expect(curve.positiveRate).toBe(0.5);
  });

  it('returns null when a class is absent', () => {
    expect(prCurve([1, 1], [0.5, 0.6])).toBeNull();
    expect(prCurve([0, 0], [0.5, 0.6])).toBeNull();
  });

  it('absorbs probability ties into a single point', () => {
    const curve = prCurve([1, 0, 1], [0.7, 0.7, 0.2])!;
    expect(curve.points[0]).toEqual({ recall: 0.5, precision: 0.5, threshold: 0.7 });
  });
});

describe('thresholdMetrics', () => {
  it('counts the confusion at a given threshold', () => {
    const m = thresholdMetrics(Y, P, 0.5);
    expect([m.tp, m.fp, m.fn, m.tn]).toEqual([1, 1, 1, 1]);
    expect(m.precision).toBe(0.5);
    expect(m.recall).toBe(0.5);
    expect(m.f1).toBe(0.5);
    expect(m.accuracy).toBe(0.5);
  });

  it('applies the cost matrix', () => {
    // At 0.5: 1 FP, 1 FN → cost 1·2 + 1·10 = 12.
    expect(thresholdMetrics(Y, P, 0.5, 2, 10).cost).toBe(12);
  });

  it('a threshold above every probability predicts nothing positive', () => {
    const m = thresholdMetrics(Y, P, 1.01);
    expect([m.tp, m.fp, m.fn, m.tn]).toEqual([0, 0, 2, 2]);
  });
});

describe('bestThresholdByCost', () => {
  it('lowers the threshold when misses are expensive', () => {
    // FN cost 10 vs FP cost 1: catching both positives (threshold 0.4,
    // 1 FP → cost 1) beats missing one (cost ≥ 10).
    const best = bestThresholdByCost(Y, P, 1, 10);
    expect(best.threshold).toBe(0.4);
    expect(best.cost).toBe(1);
    expect(best.recall).toBe(1);
  });

  it('raises the threshold when false alarms are expensive', () => {
    // FP cost 10 vs FN cost 1: threshold 0.9 → 1 FN, cost 1 — any lower cut
    // pays 10 for the 0.8 false alarm.
    const best = bestThresholdByCost(Y, P, 10, 1);
    expect(best.threshold).toBe(0.9);
    expect(best.cost).toBe(1);
    expect(best.fp).toBe(0);
  });

  it('can conclude that predicting nothing is optimal', () => {
    const best = bestThresholdByCost([0, 0, 1], [0.9, 0.8, 0.1], 100, 1);
    expect(best.threshold).toBe(1);
    expect([best.tp, best.fp]).toEqual([0, 0]);
    expect(best.cost).toBe(1);
  });
});

describe('calibrationCurve', () => {
  it('bins predictions and scores them with Brier', () => {
    const curve = calibrationCurve([1, 0, 1, 0], [0.95, 0.85, 0.15, 0.05], 10);
    // 0.05 → bin [0,0.1) · 0.15 → [0.1,0.2) · 0.85 → [0.8,0.9) · 0.95 → [0.9,1].
    expect(curve.bins).toHaveLength(4);
    expect(curve.bins[0]).toEqual({ meanPredicted: 0.05, observedRate: 0, count: 1 });
    expect(curve.bins[1]).toEqual({ meanPredicted: 0.15, observedRate: 1, count: 1 });
    expect(curve.bins[2]).toEqual({ meanPredicted: 0.85, observedRate: 0, count: 1 });
    expect(curve.bins[3]).toEqual({ meanPredicted: 0.95, observedRate: 1, count: 1 });
    // Brier = (0.05² + 0.85² + 0.15² + 0.05²) / 4
    expect(curve.brier).toBeCloseTo((0.0025 + 0.7225 + 0.0225 + 0.0025) / 4, 10);
  });

  it('a probability of exactly 1 lands in the last bin', () => {
    const curve = calibrationCurve([1], [1], 10);
    expect(curve.bins).toHaveLength(1);
    expect(curve.bins[0].meanPredicted).toBe(1);
    expect(curve.brier).toBe(0);
  });
});

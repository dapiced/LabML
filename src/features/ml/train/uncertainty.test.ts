import { describe, expect, it } from 'vitest';
import {
  MIN_UNCERTAINTY_ROWS,
  analyzeUncertainty,
  type ModelLosses,
} from '@/features/ml/train/uncertainty';
import { mulberry32 } from '@/features/ml/train/random';

const N = 100;

/** hits drawn deterministically so each model has a known accuracy. */
function hitEntry(model: ModelLosses['model'], accuracy: number, seed: number): ModelLosses {
  const rng = mulberry32(seed);
  return { model, values: Array.from({ length: N }, () => (rng() < accuracy ? 1 : 0)) };
}

describe('analyzeUncertainty', () => {
  it('brackets each accuracy with a 95% interval around the point estimate', () => {
    const perfect: ModelLosses = { model: 'gbdt', values: Array.from({ length: N }, () => 1) };
    const half = hitEntry('baseline', 0.5, 7);
    const analysis = analyzeUncertainty([perfect, half], true, 42)!;
    expect(analysis.metricLabel).toBe('accuracy');
    expect(analysis.intervals[0]).toMatchObject({ model: 'gbdt', point: 1, lo: 1, hi: 1 });
    const base = analysis.intervals[1];
    expect(base.model).toBe('baseline');
    expect(base.lo).toBeLessThan(base.point);
    expect(base.hi).toBeGreaterThan(base.point);
    expect(base.lo).toBeGreaterThan(0.3);
    expect(base.hi).toBeLessThan(0.7);
  });

  it('is deterministic for a given seed', () => {
    const entries = [hitEntry('gbdt', 0.9, 3), hitEntry('baseline', 0.6, 4)];
    expect(analyzeUncertainty(entries, true, 42)).toEqual(analyzeUncertainty(entries, true, 42));
  });

  it('calls a real gap decisive and a tie noise', () => {
    const strong = hitEntry('gbdt', 0.95, 11);
    const weak = hitEntry('baseline', 0.55, 12);
    const clear = analyzeUncertainty([strong, weak], true, 42)!.verdict!;
    expect(clear.winner).toBe('gbdt');
    expect(clear.decisive).toBe(true);
    expect(clear.lo).toBeGreaterThan(0);
    expect(clear.winShare).toBeGreaterThan(0.99);

    // Identical losses: the paired delta is exactly zero in every resample.
    const copy: ModelLosses = { model: 'baseline', values: [...strong.values] };
    const tie = analyzeUncertainty([strong, copy], true, 42)!;
    // Tiebreak is alphabetical, so 'baseline' wins and there is no verdict…
    expect(tie.intervals[0].model).toBe('baseline');
    expect(tie.verdict).toBeNull();
  });

  it('computes RMSE intervals where lower is better, and orients the verdict', () => {
    const rng = mulberry32(5);
    const good: ModelLosses = {
      model: 'linear',
      values: Array.from({ length: N }, () => rng() ** 2),
    };
    const bad: ModelLosses = {
      model: 'baseline',
      values: Array.from({ length: N }, () => (3 + rng()) ** 2),
    };
    const analysis = analyzeUncertainty([good, bad], false, 42)!;
    expect(analysis.metricLabel).toBe('rmse');
    expect(analysis.intervals[0].model).toBe('linear');
    const verdict = analysis.verdict!;
    expect(verdict.delta).toBeLessThan(0);
    expect(verdict.hi).toBeLessThan(0);
    expect(verdict.decisive).toBe(true);
    expect(verdict.winShare).toBe(1);
  });

  it('declines tiny test sets instead of printing theater', () => {
    const tiny: ModelLosses = {
      model: 'gbdt',
      values: Array.from({ length: MIN_UNCERTAINTY_ROWS - 1 }, () => 1),
    };
    expect(analyzeUncertainty([tiny], true, 42)).toBeNull();
    expect(analyzeUncertainty([], true, 42)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import {
  applyMulticlassPolicy,
  evaluateMulticlassPolicy,
} from '@/features/ml/train/multiclass-decision';

describe('applyMulticlassPolicy', () => {
  it('reproduces argmax when every threshold is zero', () => {
    expect(applyMulticlassPolicy([0.6, 0.3, 0.1], { thresholds: [0, 0, 0] })).toMatchObject({
      rawClass: 0,
      policyClass: 0,
      status: 'decided',
    });
  });

  it('chooses the eligible class with the largest normalized excess', () => {
    expect(
      applyMulticlassPolicy([0.55, 0.4, 0.05], { thresholds: [0.5, 0.2, 0.1] }).policyClass,
    ).toBe(1);
  });

  it('abstains when no class clears its threshold', () => {
    expect(applyMulticlassPolicy([0.4, 0.35, 0.25], { thresholds: [0.5, 0.5, 0.5] }).status).toBe(
      'abstained',
    );
  });

  it('accepts probability one at threshold one without dividing by zero', () => {
    expect(applyMulticlassPolicy([1, 0, 0], { thresholds: [1, 0.5, 0.5] }).policyClass).toBe(0);
  });

  it('breaks exact ties by stable class order', () => {
    expect(applyMulticlassPolicy([0.6, 0.6], { thresholds: [0.5, 0.5] }).policyClass).toBe(0);
  });

  it('rejects a policy whose threshold count differs from the probabilities', () => {
    expect(() => applyMulticlassPolicy([0.6, 0.4], { thresholds: [0.5] })).toThrow('bad-policy');
  });
});

describe('evaluateMulticlassPolicy', () => {
  it('matches argmax accuracy and full coverage at zero thresholds', () => {
    const metrics = evaluateMulticlassPolicy(
      [0, 2, 2],
      [
        [0.7, 0.2, 0.1],
        [0.1, 0.6, 0.3],
        [0.1, 0.2, 0.7],
      ],
      { thresholds: [0, 0, 0] },
    );

    expect(metrics.coverage).toBe(1);
    expect(metrics.accuracy).toBe(2 / 3);
    expect(metrics.decidedAccuracy).toBe(2 / 3);
  });

  it('counts abstentions as global errors but excludes them from decided accuracy', () => {
    const metrics = evaluateMulticlassPolicy(
      [0, 1, 2],
      [
        [0.8, 0.1, 0.1],
        [0.4, 0.35, 0.25],
        [0.1, 0.2, 0.7],
      ],
      { thresholds: [0.5, 0.5, 0.5] },
    );

    expect(metrics).toMatchObject({
      rows: 3,
      decided: 2,
      abstained: 1,
      coverage: 2 / 3,
      accuracy: 2 / 3,
      decidedAccuracy: 1,
      macroPrecision: 2 / 3,
      macroRecall: 2 / 3,
      macroF1: 2 / 3,
    });
    expect(metrics.perClass[1]).toEqual({
      classIndex: 1,
      support: 1,
      precision: 0,
      recall: 0,
      f1: 0,
    });
  });

  it('returns finite zero metrics when every row abstains', () => {
    const metrics = evaluateMulticlassPolicy(
      [0, 1],
      [
        [0.6, 0.4],
        [0.4, 0.6],
      ],
      { thresholds: [1, 1] },
    );

    expect(metrics.decided).toBe(0);
    expect(metrics.decidedAccuracy).toBe(0);
    expect(metrics.macroPrecision).toBe(0);
    expect(metrics.macroRecall).toBe(0);
    expect(metrics.macroF1).toBe(0);
    expect(Object.values(metrics).every((value) => !Number.isNaN(value))).toBe(true);
  });
});

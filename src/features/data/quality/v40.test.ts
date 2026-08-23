/**
 * V40 — the score, explained by its parts.
 */
import { describe, expect, it } from 'vitest';
import {
  TOTAL_WEIGHT,
  buildQualityReport,
  qualityScore,
  scoreBreakdown,
} from '@/features/data/quality/checks';
import type { Cell } from '@/features/ml/data/types';

/** The report without the two fields the score functions compute themselves. */
function report(header: string[], columns: Cell[][]) {
  const built = buildQualityReport(header, columns);
  const rest: Record<string, unknown> = { ...built };
  delete rest.score;
  delete rest.breakdown;
  return rest as Parameters<typeof scoreBreakdown>[0];
}

describe('V40 — the quality score is the sum of its published parts', () => {
  it('adds up to exactly the score shown', () => {
    const header = ['a', 'b'];
    const columns: Cell[][] = [
      ['1', '', '3', '4', '', '6'],
      ['x', 'X', 'y', 'y', 'z', ''],
    ];
    const partial = report(header, columns);
    const parts = scoreBreakdown(partial, 2);
    const total = parts.reduce((sum, part) => sum + part.penalty, 0);
    expect(qualityScore(partial, 2)).toBe(Math.max(0, Math.round(100 - total)));
  });

  it('names every part, with its weight, its ratio and what it cost', () => {
    const partial = report(['a'], [['1', '', '3', '4']]);
    const parts = scoreBreakdown(partial);
    expect(parts.map((p) => p.part)).toEqual([
      'missing',
      'duplicates',
      'messy',
      'outliers',
      'structural',
      'validity',
    ]);
    const missing = parts.find((p) => p.part === 'missing')!;
    expect(missing.weight).toBe(35);
    expect(missing.count).toBe(1);
    expect(missing.ratio).toBeCloseTo(0.25, 10);
    // 35 × min(1, 0.25 × 8) = 35, saturated.
    expect(missing.penalty).toBe(35);
  });

  it('keeps every pre-V40 weight untouched, so old scores still mean the same', () => {
    // Validity brought its own 5 points instead of taking them from a
    // neighbour: a file with no validity findings must score exactly what it
    // scored before this wave.
    const partial = report(
      ['a', 'b'],
      [
        ['1', '', '3', '4'],
        ['x', 'X', 'y', 'y'],
      ],
    );
    expect(qualityScore(partial, 0)).toBe(qualityScore(partial));
    const weights = scoreBreakdown(partial).map((p) => p.weight);
    expect(weights).toEqual([35, 20, 20, 15, 10, 5]);
    expect(weights.reduce((a, b) => a + b, 0)).toBe(TOTAL_WEIGHT);
  });

  it('charges for impossible values, and only when there are some', () => {
    const partial = report(['a'], [['1', '2', '3', '4', '5', '6', '7', '8']]);
    expect(scoreBreakdown(partial, 0).find((p) => p.part === 'validity')!.penalty).toBe(0);
    expect(scoreBreakdown(partial, 4).find((p) => p.part === 'validity')!.penalty).toBeGreaterThan(
      0,
    );
    expect(qualityScore(partial, 4)).toBeLessThan(qualityScore(partial, 0));
  });

  it('still gives a clean file 100 and never goes below 0', () => {
    const clean = report(
      ['a', 'b'],
      [
        ['1', '2', '3', '4'],
        ['x', 'y', 'x', 'y'],
      ],
    );
    expect(qualityScore(clean, 0)).toBe(100);
    const filthy = report(['a'], [['', '', '', '']]);
    expect(qualityScore(filthy, 4)).toBeGreaterThanOrEqual(0);
  });
});

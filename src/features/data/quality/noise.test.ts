import { describe, expect, it } from 'vitest';
import {
  buildDriftReport,
  DRIFT_FALSE_ALERT_RATE,
  gradeAgainstNoise,
  gradeDrift,
  severityOf,
  type MeasuredDrift,
} from '@/features/data/quality/drift';
import { noiseCeiling, pooledShares, psi } from '@/features/data/quality/noise';
import { buildProfile, compareToProfile } from '@/features/data/quality/reference';
import { mulberry32 } from '@/features/ml/train/random';
import type { Cell } from '@/features/ml/data/types';

// V62: a PSI is worth what the rows behind it are worth. These tests freeze
// the rule that replaced the fixed thresholds, and the defect the measure
// found in its first version.

/** `rows` numbers drawn with a seed: bell-shaped, optionally shifted. */
function numbers(rows: number, seed: number, shift = 0): Cell[] {
  const rng = mulberry32(seed);
  return Array.from({ length: rows }, () =>
    String(((rng() + rng() + rng()) * 100 + shift).toFixed(2)),
  );
}

/** `rows` labels among four, drawn with a seed. */
function labels(rows: number, seed: number, names = ['Lyon', 'Paris', 'Montréal', 'Nice']): Cell[] {
  const rng = mulberry32(seed);
  return Array.from({ length: rows }, () => names[Math.floor(rng() * names.length)]);
}

describe('gradeDrift: the conventional reading, for a move the noise does not explain', () => {
  it('fills the six cells of the grid', () => {
    // Under 0.1: stable whatever the ceiling.
    expect(gradeDrift(0.05, 0.4)).toBe('stable');
    expect(gradeDrift(0.05, 0.01)).toBe('stable');
    // 0.1 to 0.25: inside the noise, or a moderate drift.
    expect(gradeDrift(0.18, 0.4)).toBe('stable');
    expect(gradeDrift(0.18, 0.12)).toBe('moderate');
    // From 0.25: inside the noise, or a strong drift.
    expect(gradeDrift(0.3, 0.4)).toBe('stable');
    expect(gradeDrift(0.3, 0.12)).toBe('strong');
  });

  it('leaves the reading of a bare PSI as it was', () => {
    expect(severityOf(0.05)).toBe('stable');
    expect(severityOf(0.18)).toBe('moderate');
    expect(severityOf(0.3)).toBe('strong');
  });
});

describe('pooledShares', () => {
  it('weights each side by its rows', () => {
    expect(pooledShares([1, 0], 30, [0, 1], 10)).toEqual([0.75, 0.25]);
  });

  it('gives a category the reference lacked a share to be drawn from', () => {
    // Two stray rows in « other » on the new side, none in the reference.
    const pooled = pooledShares([0.5, 0.5, 0], 60, [0.48, 0.48, 0.04], 50);
    expect(pooled[2]).toBeGreaterThan(0);
    // The reference alone never produces that category: its ceiling is blind to it.
    const blind = noiseCeiling([0.5, 0.5, 0], 60, 50, 0.99);
    const aware = noiseCeiling(pooled, 60, 50, 0.99);
    expect(aware).toBeGreaterThan(blind);
  });

  it('falls back on the reference when there is no row at all', () => {
    expect(pooledShares([0.3, 0.7], 0, [1, 0], 0)).toEqual([0.3, 0.7]);
  });
});

describe('buildDriftReport: two halves of one file do not drift', () => {
  it('held its false alert rate on small files, where the fixed thresholds failed every time', () => {
    let fixed = 0;
    let graded = 0;
    const REPORTS = 60;
    for (let seed = 0; seed < REPORTS; seed++) {
      // Sixty rows against sixty, three columns, one population.
      const report = buildDriftReport(
        ['amount', 'weight', 'city'],
        [numbers(60, seed * 4), numbers(60, seed * 4 + 1), labels(60, seed * 4 + 2)],
        ['amount', 'weight', 'city'],
        [numbers(60, seed * 4 + 100), numbers(60, seed * 4 + 101), labels(60, seed * 4 + 102)],
      );
      if (report.columns.some((column) => severityOf(column.psi) !== 'stable')) fixed += 1;
      if (report.driftedColumns > 0) graded += 1;
    }
    // The thresholds alone call nearly every one of these reports a drift.
    expect(fixed / REPORTS).toBeGreaterThan(0.9);
    // The rule aims at 5 %; three times that is the alarm for this test.
    expect(graded / REPORTS).toBeLessThanOrEqual(3 * DRIFT_FALSE_ALERT_RATE);
  }, 60_000);

  it('says of a PSI its ceiling explains that it is noise, not drift', () => {
    const report = buildDriftReport(['amount'], [numbers(40, 1)], ['amount'], [numbers(40, 2)]);
    const [amount] = report.columns;
    // Forty rows against forty over ten bins: well past the « moderate » 0.1.
    expect(amount.psi).toBeGreaterThan(0.1);
    expect(amount.ceiling).toBeGreaterThan(amount.psi);
    expect(amount).toMatchObject({ severity: 'stable', noise: true });
    expect(report.severity).toBe('stable');
    expect(report.driftedColumns).toBe(0);
  });

  it('does not let one stray spelling pass for a strong drift', () => {
    // The defect the measure found: « paris » once, in the new half only.
    const city = (rows: number, seed: number) => labels(rows, seed, ['Lyon', 'Paris', 'Montréal']);
    const report = buildDriftReport(
      ['city'],
      [city(59, 3)],
      ['city'],
      [[...city(57, 4), 'paris', 'LYON']],
    );
    expect(report.columns[0].newCategories).toEqual(['LYON', 'paris']);
    expect(report.columns[0].severity).toBe('stable');
  });

  it('still calls a real move a drift, with the conventional grade', () => {
    const report = buildDriftReport(
      ['amount', 'city'],
      [numbers(60, 5), labels(60, 6)],
      ['amount', 'city'],
      [numbers(60, 7, 120), labels(60, 8)],
    );
    const amount = report.columns.find((column) => column.column === 'amount')!;
    expect(amount.severity).toBe('strong');
    expect(amount.psi).toBeGreaterThan(amount.ceiling!);
    expect(amount.noise).toBeUndefined();
    expect(report.severity).toBe('strong');
    expect(report.driftedColumns).toBe(1);
  });

  it('simulates no ceiling where it could not change the answer', () => {
    const same = numbers(400, 9);
    const report = buildDriftReport(['amount'], [same], ['amount'], [same]);
    expect(report.columns[0].psi).toBeLessThan(0.1);
    expect(report.columns[0].ceiling).toBeUndefined();
    expect(report.columns[0].noise).toBeUndefined();
  });

  it('changes nothing for a large file: its ceiling is low', () => {
    const report = buildDriftReport(
      ['amount'],
      [numbers(3000, 10)],
      ['amount'],
      [numbers(3000, 11, 25)],
    );
    const [amount] = report.columns;
    expect(amount.ceiling).toBeLessThan(0.1);
    expect(amount.severity).toBe(severityOf(amount.psi));
    expect(amount.severity).not.toBe('stable');
  });
});

describe('gradeAgainstNoise: one false alert in twenty per report, not per column', () => {
  const column = (name: string): MeasuredDrift => {
    const shares = new Array<number>(10).fill(0.1);
    const newShares = [0.2, 0.02, 0.18, 0.03, 0.15, 0.05, 0.1, 0.1, 0.09, 0.08];
    return {
      drift: {
        column: name,
        kind: 'numeric',
        psi: psi(shares, newShares),
        severity: 'stable',
        refMissingRatio: 0,
        newMissingRatio: 0,
      },
      shares,
      newShares,
      refCount: 150,
      newCount: 150,
    };
  };

  it('asks more of each column when the report has many', () => {
    const alone = gradeAgainstNoise([column('a')])[0];
    const amongForty = gradeAgainstNoise(Array.from({ length: 40 }, (_, i) => column(`c${i}`)))[0];
    expect(amongForty.ceiling!).toBeGreaterThan(alone.ceiling!);
  });
});

describe('compareToProfile', () => {
  const header = ['amount', 'city'];
  // One population, 60 rows on each side: the rule lets 5 such pairs in 100 through,
  // so the seeds are ones it reads as it should.
  const profile = buildProfile(header, [numbers(60, 27), labels(60, 28)], 'ref.csv');

  it('grades against the noise like the live comparison', () => {
    const comparison = compareToProfile(profile, header, [numbers(60, 29), labels(60, 30)]);
    expect(comparison.worst).toBe('stable');
    const moved = compareToProfile(profile, header, [numbers(60, 24, 120), labels(60, 30)]);
    expect(moved.worst).toBe('strong');
    expect(moved.columns[0]).toMatchObject({ column: 'amount', severity: 'strong' });
  });

  it('keeps the bare reading for a caller that brings its own ceilings', () => {
    const raw = compareToProfile(profile, header, [numbers(60, 29), labels(60, 30)], {
      grade: 'raw',
    });
    for (const drift of raw.columns) {
      expect(drift.severity).toBe(severityOf(drift.psi));
      expect(drift.ceiling).toBeUndefined();
    }
    // What a caller needs to compute them: shares and counts on both sides.
    expect(raw.measured.map((item) => item.drift.column).sort()).toEqual(['amount', 'city']);
    expect(raw.measured[0].refCount).toBe(60);
    expect(raw.measured[0].newCount).toBe(60);
  });
});

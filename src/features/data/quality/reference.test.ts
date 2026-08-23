/**
 * V40 — the reference profile: drift against a file you no longer have.
 */
import { describe, expect, it } from 'vitest';
import {
  PROFILE_FORMAT,
  buildProfile,
  compareToProfile,
  parseProfile,
} from '@/features/data/quality/reference';
import { buildDriftReport } from '@/features/data/quality/drift';
import { mulberry32 } from '@/features/ml/train/random';
import type { Cell } from '@/features/ml/data/types';

function numericColumn(n: number, seed: number, shift = 0): Cell[] {
  const rng = mulberry32(seed);
  return Array.from({ length: n }, () => String(Math.round((rng() * 100 + shift) * 100) / 100));
}

function categoryColumn(n: number, weights: [string, number][]): Cell[] {
  const out: Cell[] = [];
  const total = weights.reduce((sum, [, w]) => sum + w, 0);
  for (let i = 0; i < n; i++) {
    let position = (i % total) + 1;
    for (const [name, weight] of weights) {
      position -= weight;
      if (position <= 0) {
        out.push(name);
        break;
      }
    }
  }
  return out;
}

describe('V40 — a profile describes the shape, never the rows', () => {
  it('stores edges and shares, and no data', () => {
    const header = ['salaire', 'ville'];
    const columns: Cell[][] = [
      numericColumn(200, 42),
      categoryColumn(200, [
        ['Québec', 3],
        ['Montréal', 2],
      ]),
    ];
    const profile = buildProfile(header, columns, 'paie.csv');
    const serialized = JSON.stringify(profile);
    // The exact values of the file must not appear anywhere in the profile:
    // this is what makes it safe to commit beside the code it describes.
    for (const value of columns[0].slice(0, 20)) {
      expect(serialized).not.toContain(`"${String(value)}"`);
    }
    expect(profile.format).toBe(PROFILE_FORMAT);
    expect(profile.rowCount).toBe(200);
    const salary = profile.columns.find((c) => c.column === 'salaire')!;
    expect(salary.kind).toBe('numeric');
  });

  it('round-trips through JSON', () => {
    const profile = buildProfile(
      ['a', 'b'],
      [
        numericColumn(120, 7),
        categoryColumn(120, [
          ['x', 1],
          ['y', 1],
        ]),
      ],
      'ref.csv',
    );
    const parsed = parseProfile(JSON.stringify(profile));
    expect(parsed).not.toBeNull();
    expect(parsed!.columns.map((c) => c.column)).toEqual(['a', 'b']);
    expect(parsed!.source).toBe('ref.csv');
  });

  it('refuses anything that is not a LabML profile', () => {
    expect(parseProfile('{}')).toBeNull();
    expect(parseProfile('not json')).toBeNull();
    expect(parseProfile(JSON.stringify({ format: 'something-else', columns: [] }))).toBeNull();
    // A profile whose columns all failed validation describes nothing.
    expect(parseProfile(JSON.stringify({ format: PROFILE_FORMAT, columns: [{}] }))).toBeNull();
  });
});

describe('V40 — a profile scores a new file the way V11 would have', () => {
  it('finds no drift when the new file is the reference itself', () => {
    const header = ['a', 'b'];
    const columns: Cell[][] = [
      numericColumn(300, 42),
      categoryColumn(300, [
        ['x', 3],
        ['y', 2],
      ]),
    ];
    const profile = buildProfile(header, columns, 'ref.csv');
    const comparison = compareToProfile(profile, header, columns);
    expect(comparison.worst).toBe('stable');
    for (const drift of comparison.columns) expect(drift.psi).toBeCloseTo(0, 6);
  });

  it('agrees with the live two-file comparison on the same pair', () => {
    const header = ['a'];
    const reference: Cell[][] = [numericColumn(400, 42)];
    const current: Cell[][] = [numericColumn(400, 99, 40)];

    const live = buildDriftReport(header, reference, header, current);
    const viaProfile = compareToProfile(
      buildProfile(header, reference, 'ref.csv'),
      header,
      current,
    );
    // Same maths, same bins, same verdict — the profile is a stored reference,
    // not a second opinion.
    expect(viaProfile.columns[0].psi).toBeCloseTo(live.columns[0].psi, 6);
    expect(viaProfile.columns[0].severity).toBe(live.columns[0].severity);
  });

  it('detects a shifted numeric distribution', () => {
    const header = ['montant'];
    const profile = buildProfile(header, [numericColumn(400, 42)], 'ref.csv');
    const shifted = compareToProfile(profile, header, [numericColumn(400, 99, 60)]);
    expect(shifted.columns[0].psi).toBeGreaterThan(0.2);
    expect(shifted.worst).toBe('strong');
  });

  it('puts an unseen category in OTHER instead of inventing a bucket', () => {
    const header = ['ville'];
    const profile = buildProfile(
      header,
      [
        categoryColumn(200, [
          ['Québec', 3],
          ['Montréal', 2],
        ]),
      ],
      'ref.csv',
    );
    const withNew = compareToProfile(profile, header, [
      categoryColumn(200, [
        ['Québec', 1],
        ['Laval', 4],
      ]),
    ]);
    expect(withNew.columns[0].psi).toBeGreaterThan(0);
    expect(withNew.columns[0].kind).toBe('categorical');
  });

  it('names the columns that appeared and disappeared', () => {
    const profile = buildProfile(
      ['a', 'b'],
      [numericColumn(60, 1), numericColumn(60, 2)],
      'ref.csv',
    );
    const comparison = compareToProfile(
      profile,
      ['a', 'c'],
      [numericColumn(60, 1), numericColumn(60, 3)],
    );
    expect(comparison.missingColumns).toEqual(['b']);
    expect(comparison.newColumns).toEqual(['c']);
  });
});

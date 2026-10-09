/**
 * V38 — the defect, and the proof it is gone.
 *
 * This file trains the real zoo twice on the same 900 rows, changing only how
 * a number is spelled. Before V38 the French spelling cost 18 accuracy points
 * in silence; the assertions below pin the repair to be exact, not merely
 * better.
 */
import { describe, expect, it } from 'vitest';
import { applyDecimalFormats } from '@/features/ml/data/read';
import { profileColumn } from '@/features/ml/data/profile';
import { runTraining } from '@/features/ml/train/trainer';
import { mulberry32 } from '@/features/ml/train/random';
import type { Cell } from '@/features/ml/data/types';
import type { TrainConfig } from '@/features/ml/train/types';

/** The same dataset, written either `12.50` or `12,50`. */
function build(french: boolean) {
  const rng = mulberry32(42);
  const cols: Record<string, string[]> = { surface: [], prix: [], score: [], cible: [] };
  for (let i = 0; i < 900; i++) {
    const s = 30 + Math.round(rng() * 17000) / 100;
    const p = 1000 + Math.round(rng() * 900000) / 100;
    const q = Math.round(rng() * 1000) / 100;
    const write = (v: number) => (french ? v.toFixed(2).replace('.', ',') : v.toFixed(2));
    cols.surface.push(write(s));
    cols.prix.push(write(p));
    cols.score.push(write(q));
    cols.cible.push(s * 40 + p * 0.05 + q * 30 > 4200 ? 'oui' : 'non');
  }
  return cols;
}

const HEADER = ['surface', 'prix', 'score', 'cible'];
const CONFIG: TrainConfig = {
  target: 'cible',
  features: ['surface', 'prix', 'score'],
  seed: 42,
  testRatio: 0.2,
};

async function run(french: boolean, repair: boolean) {
  const data = build(french);
  const raw: Cell[][] = HEADER.map((name) => [...data[name]]);
  const rewritten = repair ? applyDecimalFormats(HEADER, raw) : [];
  const profiles = HEADER.map((name, i) => profileColumn(name, raw[i]));
  const results: { key: string; ok: boolean; primary: number; valPrimary?: number }[] = [];
  const outcome = await runTraining(
    new Map<string, Cell[]>(HEADER.map((name, i) => [name, raw[i]])),
    profiles,
    CONFIG,
    {
      onModelStart: () => {},
      onModelResult: (result) => results.push(result),
      isCancelled: () => false,
    },
  );
  const best = results
    .filter((r) => r.ok && r.key !== 'baseline')
    .sort((a, b) => (b.valPrimary ?? b.primary) - (a.valPrimary ?? a.primary))[0];
  return {
    types: profiles.slice(0, 3).map((p) => p.type),
    features: outcome!.summary.featureCount,
    accuracy: best.valPrimary ?? best.primary,
    rewritten,
  };
}

describe('V38 — a French CSV no longer loses its numeric columns', () => {
  it('reproduces the defect, then repairs it exactly', async () => {
    const english = await run(false, true);
    const brokenFrench = await run(true, false);
    const repairedFrench = await run(true, true);

    // The defect, as measured before the fix: three numeric columns become
    // text, V24's TF-IDF turns them into a hundred word features, and the
    // champion loses accuracy — with no warning anywhere.
    expect(brokenFrench.types).toEqual(['text', 'text', 'text']);
    expect(brokenFrench.features).toBeGreaterThan(50);
    expect(brokenFrench.accuracy).toBeLessThan(english.accuracy - 0.1);

    // The repair is exact, not merely an improvement: same types, same feature
    // count, same score as the file that never had the problem.
    expect(repairedFrench.types).toEqual(english.types);
    expect(repairedFrench.features).toBe(english.features);
    expect(repairedFrench.accuracy).toBeCloseTo(english.accuracy, 10);

    // And every rewritten column can say what justified it.
    expect(repairedFrench.rewritten.map((r) => r.column)).toEqual(['surface', 'prix', 'score']);
    for (const column of repairedFrench.rewritten) {
      expect(column.matched).toBe(column.total);
      expect(column.decimal).toBe(',');
    }
  }, 600_000);

  it('leaves a file that was already correct completely untouched', async () => {
    const english = await run(false, true);
    // No column rewritten, no announcement to make: the common case pays
    // nothing for this feature.
    expect(english.rewritten).toEqual([]);
  }, 600_000);
});

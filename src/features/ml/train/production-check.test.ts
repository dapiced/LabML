import { describe, expect, it } from 'vitest';
import {
  buildReference,
  checkProduction,
  FALSE_ALERT_RATE,
  MIN_LABELLED_ROWS,
  noiseCeiling,
  parseReference,
  type ProductionReference,
} from '@/features/ml/train/production-check';
import { mulberry32 } from '@/features/ml/train/random';
import type { Cell } from '@/features/ml/data/types';

// V61: a drift counts only when it can be told from the draw, and only a
// measured drop says « retrain ». These tests freeze both rules.

/** `rows` values of a numeric column and a two-valued one, drawn with a seed. */
function draw(rows: number, seed: number, shift = 0, share = 0.3) {
  const rng = mulberry32(seed);
  const amount: Cell[] = [];
  const channel: Cell[] = [];
  for (let i = 0; i < rows; i++) {
    // Sum of three uniforms: bell-shaped, no library needed.
    amount.push(String(((rng() + rng() + rng()) * 100 + shift).toFixed(2)));
    channel.push(rng() < share ? 'online' : 'store');
  }
  return [amount, channel];
}

const HEADER = ['amount', 'channel'];

function classifierReference(accuracy = 0.8, testRows = 200): ProductionReference {
  const hits = Math.round(accuracy * testRows);
  return buildReference({
    header: HEADER,
    trainColumns: draw(600, 1),
    isClassification: true,
    classCount: 2,
    // 30 % of « yes » among the answers on rows the model never saw.
    heldOutPredictions: Array.from({ length: 300 }, (_, i) => (i % 10 < 3 ? 1 : 0)),
    testPredictions: Array.from({ length: testRows }, () => 1),
    testTruth: Array.from({ length: testRows }, (_, i) => (i < hits ? 1 : 0)),
  });
}

/** A batch whose answers are « yes » for the given share of rows. */
const answers = (rows: number, yesShare: number) =>
  Array.from({ length: rows }, (_, i) => (i < Math.round(rows * yesShare) ? 1 : 0));

/** Labelled rows on which the model is right `accuracy` of the time. */
function labelled(rows: number, accuracy: number) {
  const hits = Math.round(rows * accuracy);
  return {
    predictions: Array.from({ length: rows }, () => 1),
    truth: Array.from({ length: rows }, (_, i) => (i < hits ? 1 : 0)),
  };
}

describe('noiseCeiling', () => {
  const tenBins = new Array<number>(10).fill(0.1);

  it('falls as the batch grows: a small batch is noisy, not drifted', () => {
    const at30 = noiseCeiling(tenBins, 500, 30, 0.95);
    const at100 = noiseCeiling(tenBins, 500, 100, 0.95);
    const at1000 = noiseCeiling(tenBins, 500, 1000, 0.95);
    expect(at30).toBeGreaterThan(at100);
    expect(at100).toBeGreaterThan(at1000);
    // The fixed « strong » threshold of 0.25 sits under the noise of 30 rows.
    expect(at30).toBeGreaterThan(0.25);
    // And 100 rows of unchanged data routinely pass the « moderate » 0.1.
    expect(at100).toBeGreaterThan(0.1);
  });

  it('counts the reference as a sample too', () => {
    expect(noiseCeiling(tenBins, 80, 500, 0.95)).toBeGreaterThan(
      noiseCeiling(tenBins, 5000, 500, 0.95),
    );
  });

  it('rises with the level asked for, and is the same for the same inputs', () => {
    expect(noiseCeiling(tenBins, 500, 100, 0.999)).toBeGreaterThan(
      noiseCeiling(tenBins, 500, 100, 0.9),
    );
    expect(noiseCeiling(tenBins, 500, 100, 0.95)).toBe(noiseCeiling(tenBins, 500, 100, 0.95));
  });

  it('has no ceiling to give when there is nothing to draw from', () => {
    expect(noiseCeiling([0, 0], 500, 100, 0.95)).toBe(Number.POSITIVE_INFINITY);
    expect(noiseCeiling(tenBins, 500, 0, 0.95)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('checkProduction: drift', () => {
  const reference = classifierReference();

  it('holds its false alert rate on batches where nothing moved', () => {
    let alerts = 0;
    const CHECKS = 200;
    for (let seed = 0; seed < CHECKS; seed++) {
      const check = checkProduction(reference, {
        header: HEADER,
        columns: draw(80, 1000 + seed),
        predictions: answers(80, 0.3),
        isClassification: true,
      });
      if (check.verdict !== 'stable') alerts += 1;
    }
    // The rule aims at 5 %; twice that is the alarm for this test.
    expect(alerts / CHECKS).toBeLessThanOrEqual(2 * FALSE_ALERT_RATE);
  }, 60_000);

  it('says « watch » when a column moved, and names it first', () => {
    const check = checkProduction(reference, {
      header: HEADER,
      columns: draw(200, 7, 60),
      predictions: answers(200, 0.3),
      isClassification: true,
    });
    expect(check.verdict).toBe('watch');
    expect(check.driftedColumns).toBe(1);
    expect(check.columns[0]).toMatchObject({ column: 'amount', drifted: true });
    expect(check.columns[0].psi).toBeGreaterThan(check.columns[0].ceiling);
    expect(check.columns[1]).toMatchObject({ column: 'channel', drifted: false });
    // The means say which way it went.
    expect(check.columns[0].newMean! - check.columns[0].refMean!).toBeGreaterThan(40);
  });

  it('says « watch » when only the answers moved', () => {
    const check = checkProduction(reference, {
      header: HEADER,
      columns: draw(200, 8),
      predictions: answers(200, 0.7),
      isClassification: true,
    });
    expect(check.driftedColumns).toBe(0);
    expect(check.predictions).toMatchObject({ drifted: true });
    expect(check.verdict).toBe('watch');
  });

  it('never says « retrain » without labels, however far the batch moved', () => {
    const check = checkProduction(reference, {
      header: HEADER,
      columns: draw(500, 9, 300, 0.95),
      predictions: answers(500, 1),
      isClassification: true,
    });
    expect(check.driftedColumns).toBe(2);
    expect(check.performance).toEqual({ status: 'no-labels' });
    expect(check.verdict).toBe('watch');
  });

  it('reads a regression through the bins of its predicted values', () => {
    const rng = mulberry32(3);
    const values = (rows: number, shift: number) =>
      Array.from({ length: rows }, () => rng() * 10 + shift);
    const regression = buildReference({
      header: HEADER,
      trainColumns: draw(600, 1),
      isClassification: false,
      classCount: 0,
      heldOutPredictions: values(300, 0),
      testPredictions: [1, 2, 3],
      testTruth: [1, 2, 3],
    });
    expect(regression.predictions.kind).toBe('values');
    const same = checkProduction(regression, {
      header: HEADER,
      columns: draw(200, 12),
      predictions: values(200, 0),
      isClassification: false,
    });
    expect(same.predictions?.drifted).toBe(false);
    const moved = checkProduction(regression, {
      header: HEADER,
      columns: draw(200, 12),
      predictions: values(200, 6),
      isClassification: false,
    });
    expect(moved.predictions?.drifted).toBe(true);
  });
});

describe('checkProduction: performance', () => {
  const reference = classifierReference(0.8, 200);
  const quiet = { header: HEADER, columns: draw(300, 21), predictions: answers(300, 0.3) };

  it('says « retrain » when the drop is outside the noise', () => {
    const check = checkProduction(reference, {
      ...quiet,
      labelled: labelled(300, 0.6),
      isClassification: true,
    });
    expect(check.performance).toMatchObject({ status: 'measured', reading: 'drop' });
    expect(check.verdict).toBe('retrain');
    if (check.performance.status === 'measured') {
      expect(check.performance.delta).toBeCloseTo(-0.2, 5);
      expect(check.performance.hi).toBeLessThan(0);
    }
  });

  it('does not call a drop it cannot tell from the draw', () => {
    // Twenty rows, fifteen right: 75 % against 80 %, and no way to tell.
    const check = checkProduction(reference, {
      ...quiet,
      labelled: labelled(20, 0.75),
      isClassification: true,
    });
    expect(check.performance).toMatchObject({ status: 'measured', reading: 'noise' });
    expect(check.verdict).toBe('stable');
  });

  it('reads a drift with a held performance as « watch », not « retrain »', () => {
    const check = checkProduction(reference, {
      header: HEADER,
      columns: draw(300, 22, 80),
      predictions: answers(300, 0.3),
      labelled: labelled(300, 0.82),
      isClassification: true,
    });
    expect(check.driftedColumns).toBeGreaterThan(0);
    expect(check.performance).toMatchObject({ reading: 'noise' });
    expect(check.verdict).toBe('watch');
  });

  it('lets a measured drop win over quiet columns', () => {
    const check = checkProduction(reference, {
      ...quiet,
      labelled: labelled(300, 0.5),
      isClassification: true,
    });
    expect(check.driftedColumns).toBe(0);
    expect(check.verdict).toBe('retrain');
  });

  it('measures an error through its squared errors, and refuses under thirty rows', () => {
    const rng = mulberry32(5);
    const errors = (rows: number, scale: number) =>
      Array.from({ length: rows }, () => (rng() - 0.5) * scale);
    const truth = (rows: number) => Array.from({ length: rows }, () => 0);
    const regression = buildReference({
      header: HEADER,
      trainColumns: draw(600, 1),
      isClassification: false,
      classCount: 0,
      heldOutPredictions: errors(300, 2),
      testPredictions: errors(200, 2),
      testTruth: truth(200),
    });
    const base = {
      header: HEADER,
      columns: draw(300, 23),
      predictions: errors(300, 2),
      isClassification: false,
    };

    const worse = checkProduction(regression, {
      ...base,
      labelled: { predictions: errors(200, 6), truth: truth(200) },
    });
    expect(worse.performance).toMatchObject({
      status: 'measured',
      metric: 'rmse',
      reading: 'drop',
    });
    expect(worse.verdict).toBe('retrain');

    const same = checkProduction(regression, {
      ...base,
      labelled: { predictions: errors(200, 2), truth: truth(200) },
    });
    expect(same.performance).toMatchObject({ reading: 'noise' });

    const better = checkProduction(regression, {
      ...base,
      labelled: { predictions: errors(200, 0.5), truth: truth(200) },
    });
    expect(better.performance).toMatchObject({ reading: 'gain' });
    expect(better.verdict).not.toBe('retrain');

    const few = checkProduction(regression, {
      ...base,
      labelled: { predictions: errors(12, 6), truth: truth(12) },
    });
    expect(few.performance).toEqual({ status: 'too-few', rows: 12, min: MIN_LABELLED_ROWS });
    expect(few.verdict).toBe('stable');
  });
});

describe('checkProduction: an export with no reference', () => {
  const batch = { header: HEADER, columns: draw(300, 31, 300), predictions: answers(300, 1) };

  it('reads nothing of the columns or the answers, and says so', () => {
    const check = checkProduction(null, { ...batch, isClassification: true });
    expect(check.hasReference).toBe(false);
    expect(check.columns).toEqual([]);
    expect(check.predictions).toBeNull();
    expect(check.verdict).toBe('stable');
  });

  it('still measures a classifier on its labels, from the figures the manifest carries', () => {
    const check = checkProduction(null, {
      ...batch,
      labelled: labelled(300, 0.55),
      isClassification: true,
      fallback: { rows: 200, accuracy: 0.8 },
    });
    expect(check.performance).toMatchObject({ status: 'measured', reading: 'drop' });
    expect(check.verdict).toBe('retrain');
  });

  it('gives no interval where the export does not carry what one needs', () => {
    const noRows = checkProduction(null, {
      ...batch,
      labelled: labelled(300, 0.55),
      isClassification: true,
      fallback: { rows: null, accuracy: 0.8 },
    });
    expect(noRows.performance).toEqual({ status: 'no-spread', rows: 300 });
    const regression = checkProduction(null, {
      ...batch,
      labelled: { predictions: answers(300, 1), truth: answers(300, 0) },
      isClassification: false,
      fallback: { rows: 200 },
    });
    expect(regression.performance).toEqual({ status: 'no-spread', rows: 300 });
  });
});

describe('the reference', () => {
  const reference = classifierReference();

  it('holds shares, edges and counts, and no value of any row', () => {
    const text = JSON.stringify(reference);
    const [amount, channel] = draw(600, 1);
    // Bin edges are quantiles between values; no cell appears as written.
    const leaked = amount.filter((cell) => text.includes(`"${cell as string}"`));
    expect(leaked).toEqual([]);
    expect(reference.rows).toBe(600);
    expect(reference.columns.map((column) => column.kind)).toEqual(['numeric', 'categorical']);
    expect(new Set(channel).size).toBe(2);
    expect(reference.performance).toEqual({ rows: 200, accuracy: 0.8 });
  });

  it('survives a round trip through JSON unchanged', () => {
    expect(parseReference(JSON.parse(JSON.stringify(reference)))).toEqual(reference);
  });

  it('is refused whole when any part of it cannot be trusted', () => {
    const copy = () => JSON.parse(JSON.stringify(reference)) as Record<string, unknown>;
    const broken: Record<string, unknown>[] = [];
    broken.push({ ...copy(), v: 2 });
    broken.push({ ...copy(), rows: 0 });
    broken.push({ ...copy(), columns: 'all of them' });
    broken.push({ ...copy(), columns: [{ kind: 'numeric', column: 'amount' }] });
    broken.push({ ...copy(), predictions: { kind: 'classes', rows: 300, shares: [0.7, 3] } });
    broken.push({ ...copy(), predictions: { kind: 'values', rows: 300, edges: [1], shares: [1] } });
    broken.push({ ...copy(), performance: { rows: 200 } });
    broken.push({ ...copy(), performance: { rows: 200, accuracy: 1.4 } });
    const numeric = copy();
    (numeric.columns as { shares: number[] }[])[0].shares.pop();
    broken.push(numeric);
    for (const candidate of broken) expect(parseReference(candidate)).toBeNull();
    for (const junk of [null, 7, 'reference', [], {}]) expect(parseReference(junk)).toBeNull();
  });
});

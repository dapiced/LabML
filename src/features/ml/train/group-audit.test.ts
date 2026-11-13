import { describe, expect, it } from 'vitest';
import {
  auditGroups,
  isGroupAuditRefusal,
  MIN_GROUP_ROWS,
  MIN_RATE_CASES,
  shareEstimate,
  shareGap,
  type GroupAudit,
  type GroupAuditInput,
} from '@/features/ml/train/group-audit';
import type { Cell } from '@/features/ml/data/types';

// V59: does the model treat these groups differently? The figures below are
// counted by hand on confusion matrices small enough to check on paper.

/** One block of identical test rows: group, truth, prediction, how many. */
type Block = [group: string | null, truth: number, predicted: number, count: number];

function input(blocks: Block[], overrides: Partial<GroupAuditInput> = {}): GroupAuditInput {
  const group: Cell[] = [];
  const testY: number[] = [];
  const predictions: number[] = [];
  for (const [value, truth, predicted, count] of blocks) {
    for (let i = 0; i < count; i++) {
      group.push(value);
      testY.push(truth);
      predictions.push(predicted);
    }
  }
  return {
    header: ['group', 'y'],
    columns: [group, testY.map(String)],
    testIndices: testY.map((_, i) => i),
    testY,
    predictions,
    classes: ['no', 'yes'],
    isClassification: true,
    target: 'y',
    featureColumns: [],
    model: 'gbdt',
    column: 'group',
    seed: 42,
    ...overrides,
  };
}

/**
 * 100 women and 100 men. The model says « yes » to 60 women and 35 men.
 * Women: 40 true yes (36 found), 60 true no (24 flagged).
 * Men:   30 true yes (15 found), 70 true no (20 flagged).
 */
const HUNDREDS: Block[] = [
  ['women', 1, 1, 36],
  ['women', 1, 0, 4],
  ['women', 0, 1, 24],
  ['women', 0, 0, 36],
  ['men', 1, 1, 15],
  ['men', 1, 0, 15],
  ['men', 0, 1, 20],
  ['men', 0, 0, 50],
];

const audit = (blocks: Block[], overrides?: Partial<GroupAuditInput>) =>
  auditGroups(input(blocks, overrides)) as GroupAudit;

describe('the rates of one group', () => {
  it('reads selection, recall and false alarms off the confusion matrix', () => {
    const result = audit(HUNDREDS);
    expect(result.kind).toBe('binary');
    expect(result.positiveClass).toBe('yes');
    expect(result.rates).toEqual(['selection', 'recall', 'falseAlarm', 'accuracy']);
    const women = result.groups.find((group) => group.value === 'women')!;
    expect(women.rows).toBe(100);
    expect(women.rates.selection).toMatchObject({ value: 0.6, cases: 100 });
    expect(women.rates.recall).toMatchObject({ value: 0.9, cases: 40 });
    expect(women.rates.falseAlarm).toMatchObject({ value: 0.4, cases: 60 });
    expect(women.rates.accuracy).toMatchObject({ value: 0.72, cases: 100 });
    const men = result.groups.find((group) => group.value === 'men')!;
    expect(men.rates.selection).toMatchObject({ value: 0.35, cases: 100 });
    expect(men.rates.recall).toMatchObject({ value: 0.5, cases: 30 });
  });

  it('brackets each rate with its Wilson interval', () => {
    const selection = audit(HUNDREDS).groups[0].rates.selection!;
    expect(selection.lo).toBeLessThan(selection.value);
    expect(selection.hi).toBeGreaterThan(selection.value);
    // 60 of 100: the Wilson interval is 50.2 % to 69.1 %.
    const sixty = shareEstimate(60, 100, MIN_RATE_CASES)!;
    expect(sixty.lo).toBeCloseTo(0.502, 3);
    expect(sixty.hi).toBeCloseTo(0.691, 3);
  });

  it('does not compute a rate whose own denominator is too small', () => {
    // 30 rows in each group, but only 4 true positives among the men.
    const result = audit([
      ['women', 1, 1, 12],
      ['women', 0, 0, 18],
      ['men', 1, 1, 2],
      ['men', 1, 0, 2],
      ['men', 0, 0, 26],
    ]);
    const men = result.groups.find((group) => group.value === 'men')!;
    expect(men.rates.recall).toBeNull();
    expect(men.rates.selection).not.toBeNull();
    // And a gap needs the rate on both sides: none is reported for recall.
    expect(result.gaps.some((gap) => gap.rate === 'recall')).toBe(false);
    expect(shareEstimate(3, MIN_RATE_CASES - 1, MIN_RATE_CASES)).toBeNull();
  });
});

describe('a gap, and whether it is real', () => {
  it('reads every gap against the largest group', () => {
    const result = audit([...HUNDREDS, ['other', 1, 1, 15], ['other', 0, 0, 15]]);
    expect(result.reference).toBe('men');
    expect(result.groups.map((group) => group.value)).toEqual(['men', 'women', 'other']);
    expect(new Set(result.gaps.map((gap) => gap.group))).toEqual(new Set(['women', 'other']));
  });

  it('calls a 25-point gap on 100 rows each real: 11 to 38 points', () => {
    const gap = audit(HUNDREDS).gaps.find((entry) => entry.rate === 'selection')!;
    expect(gap.group).toBe('women');
    expect(gap.delta).toBeCloseTo(0.25, 12);
    expect(gap.lo).toBeCloseTo(0.112, 2);
    expect(gap.hi).toBeCloseTo(0.375, 2);
    expect(gap.real).toBe(true);
  });

  it('calls the same gap on 20 rows each inside the noise', () => {
    // 12 of 20 against 7 of 20: the same 25 points, a fifth of the rows.
    const result = audit([
      ['women', 1, 1, 12],
      ['women', 0, 0, 8],
      ['men', 1, 1, 7],
      ['men', 0, 0, 13],
    ]);
    const gap = result.gaps.find((entry) => entry.rate === 'selection')!;
    expect(Math.abs(gap.delta)).toBeCloseTo(0.25, 12);
    expect(gap.lo).toBeLessThan(0);
    expect(gap.hi).toBeGreaterThan(0);
    expect(gap.real).toBe(false);
  });

  it('builds the gap interval from the two Wilson intervals (Newcombe)', () => {
    const a = shareEstimate(60, 100, 1)!;
    const b = shareEstimate(35, 100, 1)!;
    const gap = shareGap(a, b);
    expect(gap.lo).toBeCloseTo(0.25 - Math.hypot(0.6 - a.lo, b.hi - 0.35), 12);
    expect(gap.hi).toBeCloseTo(0.25 + Math.hypot(a.hi - 0.6, 0.35 - b.lo), 12);
    // Two identical shares: a gap of zero, bracketed on both sides.
    const none = shareGap(a, a);
    expect(none.delta).toBe(0);
    expect(none.lo).toBeLessThan(0);
    expect(none.hi).toBeGreaterThan(0);
  });

  it('stays inside the possible values at the edges', () => {
    const all = shareEstimate(30, 30, 1)!;
    const nothing = shareEstimate(0, 30, 1)!;
    const gap = shareGap(all, nothing);
    expect(gap.delta).toBe(1);
    expect(gap.hi).toBeLessThanOrEqual(1 + 1e-12);
    expect(gap.lo).toBeGreaterThan(0.7);
  });
});

describe('rule 3 — a group too small is listed, not compared', () => {
  it('sets aside a group under the floor, with its size', () => {
    const result = audit([...HUNDREDS, ['other', 1, 1, MIN_GROUP_ROWS - 1]]);
    expect(result.groups.map((group) => group.value)).toEqual(['men', 'women']);
    expect(result.small).toEqual([{ value: 'other', rows: MIN_GROUP_ROWS - 1 }]);
    expect(result.minRows).toBe(MIN_GROUP_ROWS);
  });

  it('keeps a group exactly at the floor', () => {
    const result = audit([...HUNDREDS, ['other', 1, 1, MIN_GROUP_ROWS]]);
    expect(result.groups.map((group) => group.value)).toContain('other');
  });

  it('refuses with the sizes when fewer than two groups can be compared', () => {
    const outcome = auditGroups(
      input([
        ['women', 1, 1, 50],
        ['men', 1, 1, 5],
        ['other', 0, 0, 3],
      ]),
    )!;
    expect(isGroupAuditRefusal(outcome)).toBe(true);
    expect(outcome).toEqual({
      model: 'gbdt',
      column: 'group',
      refused: 'too-few-groups',
      minRows: MIN_GROUP_ROWS,
      groups: [
        { value: 'women', rows: 50 },
        { value: 'men', rows: 5 },
        { value: 'other', rows: 3 },
      ],
    });
  });

  it('counts the rows with no value instead of inventing a group for them', () => {
    const result = audit([...HUNDREDS, [null, 1, 1, 7]]);
    expect(result.missingRows).toBe(7);
    expect(result.groups).toHaveLength(2);
    expect(result.testRows).toBe(207);
  });

  it('compares the eight largest groups and says how many it left out', () => {
    const blocks: Block[] = [];
    for (let g = 0; g < 10; g++) {
      blocks.push([`g${g}`, 1, 1, 15 + g], [`g${g}`, 0, 0, 15 + g]);
    }
    const result = audit(blocks);
    expect(result.groups).toHaveLength(8);
    expect(result.beyondCap).toBe(2);
    expect(result.groups[0].value).toBe('g9');
  });
});

describe('what is audited', () => {
  it('has no answer for a column that is missing, numeric, or the target', () => {
    expect(auditGroups(input(HUNDREDS, { column: 'nope' }))).toBeNull();
    expect(auditGroups(input(HUNDREDS, { column: 'y' }))).toBeNull();
    const ages = HUNDREDS.flatMap(([, , , count], b) =>
      Array.from({ length: count }, (_, i) => String(18 + ((b * 7 + i) % 60))),
    );
    const numeric = input(HUNDREDS);
    numeric.header = ['age', 'y'];
    numeric.columns = [ages, numeric.columns[1]];
    numeric.column = 'age';
    expect(auditGroups(numeric)).toBeNull();
  });

  it('says whether the column was among the features', () => {
    expect(audit(HUNDREDS).inFeatures).toBe(false);
    expect(audit(HUNDREDS, { featureColumns: ['group'] }).inFeatures).toBe(true);
  });

  it('records the decision threshold only when one was applied', () => {
    expect(audit(HUNDREDS).threshold).toBeUndefined();
    expect(audit(HUNDREDS, { threshold: 0.35 }).threshold).toBe(0.35);
  });

  it('reports accuracy alone on a multiclass target', () => {
    const result = audit(
      [
        ['a', 2, 2, 25],
        ['a', 1, 0, 5],
        ['b', 0, 0, 12],
        ['b', 2, 1, 18],
      ],
      { classes: ['x', 'y', 'z'] },
    );
    expect(result.kind).toBe('multiclass');
    expect(result.rates).toEqual(['accuracy']);
    expect(result.positiveClass).toBeUndefined();
    expect(result.groups[0].rates.accuracy!.value).toBeCloseTo(25 / 30, 12);
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].real).toBe(true);
  });

  it('reports the signed and the absolute error on a regression', () => {
    // The model overestimates group a by 2 and is right on group b.
    const blocks: Block[] = [
      ['a', 10, 12, 40],
      ['b', 10, 10, 40],
    ];
    const result = audit(blocks, { isClassification: false, classes: [] });
    expect(result.kind).toBe('regression');
    expect(result.rates).toEqual(['bias', 'mae']);
    const a = result.groups.find((group) => group.value === 'a')!;
    expect(a.rates.bias!.value).toBe(2);
    expect(a.rates.mae!.value).toBe(2);
    const gap = result.gaps.find((entry) => entry.rate === 'bias')!;
    expect(Math.abs(gap.delta)).toBe(2);
    expect(gap.real).toBe(true);
  });

  it('finds no real gap between two groups the regression treats alike', () => {
    const blocks: Block[] = [];
    for (let i = 0; i < 40; i++) {
      blocks.push(['a', 10, 10 + ((i * 7) % 5) - 2, 1], ['b', 10, 10 + ((i * 3) % 5) - 2, 1]);
    }
    const result = audit(blocks, { isClassification: false, classes: [] });
    expect(result.gaps.every((gap) => !gap.real)).toBe(true);
  });

  it('is the same audit twice, and another one with another seed', () => {
    const blocks: Block[] = [];
    for (let i = 0; i < 60; i++) blocks.push([i % 2 ? 'a' : 'b', 10, 10 + ((i * 7) % 9) - 4, 1]);
    const regression = { isClassification: false, classes: [] };
    expect(audit(blocks, regression)).toEqual(audit(blocks, regression));
    expect(audit(blocks, { ...regression, seed: 43 }).groups[0].rates.bias!.lo).not.toBe(
      audit(blocks, regression).groups[0].rates.bias!.lo,
    );
    // A classification audit draws nothing at all.
    expect(audit(HUNDREDS, { seed: 1 })).toEqual(audit(HUNDREDS, { seed: 2 }));
  });
});

import { describe, expect, it } from 'vitest';
import { MIN_SEGMENT_ROWS, analyzeSegments } from '@/features/ml/train/segments';
import type { Cell } from '@/features/ml/data/types';

// 40 test rows over an 80-row dataset: even original rows are in the test set.
const N = 80;
const testIndices = Array.from({ length: 40 }, (_, i) => i * 2);

function buildColumns(): { header: string[]; columns: Cell[][] } {
  const group: Cell[] = [];
  const rare: Cell[] = [];
  const label: Cell[] = [];
  const id: Cell[] = [];
  for (let i = 0; i < N; i++) {
    group.push(i % 4 === 0 ? 'A' : 'B'); // A gets 1/4 of rows
    rare.push(i < 4 ? 'tiny' : 'common'); // 'tiny' has 2 test rows → excluded
    label.push(i % 2 === 0 ? 'yes' : 'no');
    id.push(String(i));
  }
  return { header: ['group', 'rare', 'label', 'id'], columns: [group, rare, label, id] };
}

describe('analyzeSegments', () => {
  it('slices the test set per category and reports honest deltas', () => {
    const { header, columns } = buildColumns();
    const y = testIndices.map(() => 1);
    // The model is right everywhere except on every 'A' row (positions 0,2,4…
    // of the test set map to original rows 0,4,8… — the A quarter).
    const predictions = testIndices.map((original) => (original % 4 === 0 ? 0 : 1));
    const analysis = analyzeSegments(
      header,
      columns,
      testIndices,
      y,
      predictions,
      true,
      'label',
      ['group'],
      'logistic',
    )!;
    expect(analysis.metricLabel).toBe('accuracy');
    expect(analysis.overall).toBeCloseTo(0.5, 10);
    const group = analysis.columns.find((c) => c.column === 'group')!;
    expect(group.inFeatures).toBe(true);
    // Worst first: A at 0, then B at 1.
    expect(group.segments.map((s) => [s.value, s.metric])).toEqual([
      ['A', 0],
      ['B', 1],
    ]);
    expect(group.segments[0].delta).toBeCloseTo(-0.5, 10);
    expect(group.segments[0].rows).toBe(20);
    expect(group.spread).toBeCloseTo(0.5, 10);
  });

  it('excludes tiny slices, counts them, and skips one-segment columns', () => {
    const { header, columns } = buildColumns();
    const y = testIndices.map(() => 1);
    const predictions = testIndices.map(() => 1);
    const analysis = analyzeSegments(
      header,
      columns,
      testIndices,
      y,
      predictions,
      true,
      'label',
      [],
      'logistic',
    );
    // 'rare' keeps only 'common' after excluding 'tiny' → not comparable,
    // dropped entirely; 'group' survives; the id column is never a slice.
    expect(analysis!.columns.map((c) => c.column)).toEqual(['group']);
    expect(analysis!.columns[0].smallSegments).toBe(0);
    expect(analysis!.columns[0].inFeatures).toBe(false);
  });

  it('computes per-slice RMSE for regression, worst first', () => {
    const { header, columns } = buildColumns();
    const y = testIndices.map(() => 10);
    // Off by 4 on the A quarter, off by 1 elsewhere.
    const predictions = testIndices.map((original) => (original % 4 === 0 ? 14 : 11));
    const analysis = analyzeSegments(
      header,
      columns,
      testIndices,
      y,
      predictions,
      false,
      'label',
      [],
      'linear',
    )!;
    expect(analysis.metricLabel).toBe('rmse');
    const group = analysis.columns.find((c) => c.column === 'group')!;
    expect(group.segments[0].value).toBe('A');
    expect(group.segments[0].metric).toBeCloseTo(4, 10);
    expect(group.segments[1].metric).toBeCloseTo(1, 10);
    expect(group.segments[0].delta).toBeGreaterThan(0);
  });

  it('declines when the test set is too small to slice', () => {
    const { header, columns } = buildColumns();
    const few = testIndices.slice(0, MIN_SEGMENT_ROWS);
    expect(
      analyzeSegments(
        header,
        columns,
        few,
        few.map(() => 1),
        few.map(() => 1),
        true,
        'label',
        [],
        'logistic',
      ),
    ).toBeNull();
  });
});

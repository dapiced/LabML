import { describe, expect, it } from 'vitest';
import { profileColumn } from '@/features/ml/data/profile';
import { filledLines, filledShare, MOSTLY_FILLED, readFilled } from '@/features/ml/train/filled';
import { countFilled, fitPipeline } from '@/features/ml/train/pipeline';
import { runTraining } from '@/features/ml/train/trainer';
import type { Cell } from '@/features/ml/data/types';
import i18n from '@/lib/i18n';

// V71: the cells the encoder fills are counted, per column, empty apart from
// unreadable, and nothing about the filling changes.

const N = 100;
const age = Array.from({ length: N }, (_, i) =>
  i % 5 === 0 ? '' : i === 7 ? 'twelve' : String(20 + (i % 40)),
);
const deck = Array.from({ length: N }, (_, i) =>
  i % 4 === 0 ? ['C', 'B', 'C', 'E'][(i / 4) % 4] : '',
);
const city = Array.from({ length: N }, (_, i) => ['paris', 'lyon'][i % 2]);
const note = Array.from({ length: N }, (_, i) =>
  i < 3 ? '' : `some free words about row ${i} here`,
);
const label = Array.from({ length: N }, (_, i) => (i % 3 === 0 ? 'yes' : 'no'));
const data: Record<string, Cell[]> = { age, deck, city, note, label };
const columns = new Map(Object.entries(data));
const profiles = Object.entries(data).map(([name, cells]) => profileColumn(name, cells));
const rows = Array.from({ length: N }, (_, i) => i);
const t = i18n.getFixedT('en');

describe('countFilled', () => {
  const pipeline = fitPipeline(columns, profiles, ['age', 'deck', 'city', 'note'], rows);

  it('counts empty and unreadable cells apart, per column, and says what stood in', () => {
    const filled = countFilled(pipeline.specs, (name) => columns.get(name), rows);
    expect(filled).toEqual([
      { column: 'age', rows: 100, empty: 20, unreadable: 1, fill: expect.any(String) },
      { column: 'deck', rows: 100, empty: 75, unreadable: 0, fill: 'C' },
      { column: 'note', rows: 100, empty: 3, unreadable: 0, fill: null },
    ]);
    const numeric = pipeline.specs.find((spec) => spec.name === 'age');
    expect(numeric?.kind === 'numeric' && Number(filled[0].fill)).toBe(
      numeric?.kind === 'numeric' ? Number(numeric.median.toFixed(4)) : -1,
    );
  });

  it('leaves out a column with nothing filled, and counts only the rows given', () => {
    const filled = countFilled(pipeline.specs, (name) => columns.get(name), [1, 2, 3]);
    expect(filled.map((item) => item.column)).toEqual(['deck', 'note']);
    expect(filled[0]).toMatchObject({ rows: 3, empty: 3 });
  });

  it('counts a whole scored file when no rows are named', () => {
    const batch = new Map<string, Cell[]>([
      ['age', ['30', '', 'abc']],
      ['deck', ['C', 'C', 'C']],
      ['city', ['paris', '', 'lyon']],
      ['note', ['a b c', 'd e f', 'g h i']],
    ]);
    expect(countFilled(pipeline.specs, (name) => batch.get(name), null)).toEqual([
      { column: 'age', rows: 3, empty: 1, unreadable: 1, fill: expect.any(String) },
      { column: 'city', rows: 3, empty: 1, unreadable: 0, fill: 'lyon' },
    ]);
  });

  it('travels with the summary of a run, and moves none of its figures', async () => {
    const outcome = await runTraining(
      columns,
      profiles,
      { target: 'label', features: ['age', 'deck', 'city', 'note'], seed: 5, testRatio: 0.2 },
      { onModelStart() {}, onModelResult() {}, isCancelled: () => false },
    );
    const filled = outcome!.summary.filled!;
    expect(filled.map((item) => item.column)).toEqual(['age', 'deck', 'note']);
    // Every labelled row of the run is counted once.
    expect(filled[1].rows).toBe(N);
    expect(filled[1].empty).toBe(75);
  });
});

describe('readFilled', () => {
  it('keeps what the lab writes and drops anything else', () => {
    const good = { column: 'deck', rows: 891, empty: 688, unreadable: 0, fill: 'C' };
    expect(readFilled([good])).toEqual([good]);
    expect(readFilled(undefined)).toEqual([]);
    expect(readFilled('deck')).toEqual([]);
    expect(
      readFilled([
        null,
        { ...good, rows: 0 },
        { ...good, empty: 900 },
        { ...good, empty: -1 },
        { ...good, empty: 0 },
        { ...good, column: 3 },
        { ...good, fill: 4 },
        { ...good, rows: 1.5 },
      ]),
    ).toEqual([]);
  });
});

describe('filledLines', () => {
  const filled = [
    { column: 'age', rows: 891, empty: 177, unreadable: 0, fill: '28.5' },
    { column: 'deck', rows: 891, empty: 688, unreadable: 0, fill: 'C' },
    { column: 'price', rows: 1200, empty: 3, unreadable: 12, fill: '9.9' },
    { column: 'code', rows: 10, empty: 0, unreadable: 1, fill: '4' },
    { column: 'note', rows: 240, empty: 1, unreadable: 0, fill: null },
  ];

  it('says how many, of how many, and by what, the most filled first', () => {
    const lines = filledLines(filled, t, 'en');
    expect(lines.map((line) => line.column)).toEqual(['deck', 'age', 'code', 'price', 'note']);
    expect(lines[0].text).toBe(
      'deck: 688 cells were empty of 891 (77 %). Filled with "C". Most of what the models read in this column is that value, which nobody recorded.',
    );
    expect(lines[0].mostly).toBe(true);
    expect(lines[1].text).toBe('age: 177 cells were empty of 891 (20 %). Filled with "28.5".');
    expect(lines[1].mostly).toBe(false);
    expect(lines[2].text).toBe(
      'code: 1 cell could not be read as a number of 10 (10 %). Filled with "4".',
    );
    expect(lines[3].text).toBe(
      'price: 3 cells were empty and 12 could not be read as a number, of 1,200 (1 %). Filled with "9.9".',
    );
    expect(lines[4].text).toBe(
      'note: 1 cell was empty of 240 (0 %). Left with no word: a missing text is not filled.',
    );
  });

  it('marks a column past one half, and not one at it', () => {
    expect(MOSTLY_FILLED).toBe(0.5);
    const half = { column: 'a', rows: 10, empty: 5, unreadable: 0, fill: 'x' };
    expect(filledShare(half)).toBe(0.5);
    expect(filledLines([half], t, 'en')[0].mostly).toBe(false);
    expect(filledLines([{ ...half, empty: 6 }], t, 'en')[0].mostly).toBe(true);
  });

  it('speaks French', () => {
    const lines = filledLines(filled, i18n.getFixedT('fr'), 'fr');
    expect(lines[0].text).toContain(
      'deck : 688 cellules étaient vides sur 891 (77 %). Remplies par « C ».',
    );
  });
});

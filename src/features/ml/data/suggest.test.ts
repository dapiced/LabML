import { describe, expect, it } from 'vitest';
import { profileColumn } from '@/features/ml/data/profile';
import {
  analyzeTarget,
  baselineSuggestions,
  detectTask,
  redundancySuggestions,
} from '@/features/ml/data/suggest';
import type { Cell } from '@/features/ml/data/types';

function makeColumns(data: Record<string, Cell[]>) {
  const columns = new Map(Object.entries(data));
  const profiles = Object.entries(data).map(([name, values]) => profileColumn(name, values));
  return { columns, profiles };
}

describe('baselineSuggestions', () => {
  it('flags identifiers, constants and near-empty columns', () => {
    const rows = 100;
    const { profiles } = makeColumns({
      user_id: Array.from({ length: rows }, (_, i) => String(i)),
      constant: Array.from({ length: rows }, () => 'same'),
      sparse: Array.from({ length: rows }, (_, i) => (i === 0 ? 'x' : null)),
      fine: Array.from({ length: rows }, (_, i) => (i % 2 === 0 ? 'a' : 'b')),
    });
    const reasons = Object.fromEntries(
      baselineSuggestions(profiles).map((s) => [s.column, s.reason]),
    );
    expect(reasons).toEqual({ user_id: 'id', constant: 'constant', sparse: 'nearEmpty' });
  });
});

describe('detectTask', () => {
  it('classifies categorical targets as binary or multiclass', () => {
    const binary = ['yes', 'no', 'yes', 'no'];
    expect(detectTask(profileColumn('t', binary), binary)?.type).toBe('binary');
    const multi = ['a', 'b', 'c', 'a', 'b', 'c'];
    expect(detectTask(profileColumn('t', multi), multi)?.type).toBe('multiclass');
  });

  it('treats low-cardinality integer targets as classification', () => {
    const values = Array.from({ length: 200 }, (_, i) => String(i % 2));
    const task = detectTask(profileColumn('survived', values), values);
    expect(task?.type).toBe('binary');
    expect(task?.classes).toEqual(['0', '1']);
  });

  it('treats continuous numeric targets as regression', () => {
    const values = Array.from({ length: 200 }, (_, i) => String(i * 1.37));
    expect(detectTask(profileColumn('price', values), values)?.type).toBe('regression');
  });
});

describe('analyzeTarget', () => {
  it('detects a categorical leak (the "alive vs survived" case)', () => {
    const survived = Array.from({ length: 100 }, (_, i) => String(i % 2));
    const alive = survived.map((v) => (v === '1' ? 'yes' : 'no'));
    // Odd modulus so a given age value occurs with both target classes (no accidental leak).
    const age = Array.from({ length: 100 }, (_, i) => String(20 + ((i * 7) % 37)));
    const { columns, profiles } = makeColumns({ survived, alive, age });
    const analysis = analyzeTarget('survived', columns, profiles);
    expect(analysis.task?.type).toBe('binary');
    expect(analysis.suggestions).toEqual([{ column: 'alive', reason: 'leak' }]);
  });

  it('detects a numeric leak through near-perfect correlation', () => {
    const price = Array.from({ length: 100 }, (_, i) => String(100 + i * 3));
    const priceWithTax = Array.from({ length: 100 }, (_, i) => String((100 + i * 3) * 1.15));
    const surface = Array.from({ length: 100 }, (_, i) => String(30 + ((i * 17) % 90)));
    const { columns, profiles } = makeColumns({ price, priceWithTax, surface });
    const analysis = analyzeTarget('price', columns, profiles);
    expect(analysis.task?.type).toBe('regression');
    expect(analysis.suggestions).toEqual([{ column: 'priceWithTax', reason: 'leak' }]);
  });

  it('rejects unusable targets with a reason', () => {
    const id = Array.from({ length: 50 }, (_, i) => String(i));
    const { columns, profiles } = makeColumns({ row_id: id });
    const analysis = analyzeTarget('row_id', columns, profiles);
    expect(analysis.task).toBeNull();
    expect(analysis.unsupportedReason).toBe('type');
  });
});

// V70: two columns that say the same thing are flagged, both ways or one, and
// never on the strength of a coincidence.
describe('redundancySuggestions', () => {
  const N = 120;
  const pclass = Array.from({ length: N }, (_, i) => String((i % 3) + 1));
  const klass = pclass.map((value) => ['First', 'Second', 'Third'][Number(value) - 1]);
  const who = Array.from({ length: N }, (_, i) => ['man', 'woman', 'child'][(i * 7) % 3]);
  const adultMale = who.map((value) => (value === 'man' ? 'True' : 'False'));
  const noise = Array.from({ length: N }, (_, i) => ['a', 'b', 'c', 'd'][(i * 5 + (i % 7)) % 4]);
  const find = (data: Record<string, Cell[]>) => {
    const columns = new Map(Object.entries(data));
    const profiles = Object.entries(data).map(([name, cells]) => profileColumn(name, cells));
    return redundancySuggestions(columns, profiles);
  };

  it('flags two columns that map one to one, on both, whatever their type', () => {
    expect(find({ pclass, class: klass, noise })).toEqual([
      { column: 'pclass', of: 'class', relation: 'same' },
      { column: 'class', of: 'pclass', relation: 'same' },
    ]);
  });

  it('flags only the column that can be read off the other when it goes one way', () => {
    expect(find({ who, adult_male: adultMale, noise })).toEqual([
      { column: 'adult_male', of: 'who', relation: 'determined' },
    ]);
  });

  it('judges a pair on the rows where both hold a value', () => {
    const holes = klass.map((value, i) => (i % 4 === 0 ? '' : value));
    expect(find({ pclass, class: holes }).map((pair) => pair.relation)).toEqual(['same', 'same']);
  });

  it('flags nothing between columns that merely go together often', () => {
    const almost = klass.map((value, i) => (i === 17 ? 'First' : value));
    expect(find({ pclass, class: almost, noise })).toEqual([]);
  });

  it('does not take a near-unique column for a twin of everything', () => {
    // An identifier determines every column: that says nothing about them.
    const id = Array.from({ length: N }, (_, i) => `row-${i}`);
    const code = Array.from({ length: N }, (_, i) => `c${i % 40}`);
    expect(find({ id, code, pclass })).toEqual([]);
  });

  it('does not judge a pair on a handful of shared rows', () => {
    const few = klass.map((value, i) => (i < 20 ? value : ''));
    expect(find({ pclass, class: few })).toEqual([]);
  });

  it('flags two numbers that move together almost perfectly, and not two that do not', () => {
    const metres = Array.from({ length: N }, (_, i) => String(1 + i * 0.37));
    const feet = metres.map((value) => String(Number(value) * 3.28084));
    const other = Array.from({ length: N }, (_, i) => String((i * 37) % 101));
    expect(find({ metres, feet, other })).toEqual([
      { column: 'metres', of: 'feet', relation: 'same' },
      { column: 'feet', of: 'metres', relation: 'same' },
    ]);
  });

  it('leaves text, dates and constants out', () => {
    const constant = Array.from({ length: N }, () => 'x');
    const day = Array.from(
      { length: N },
      (_, i) => `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
    );
    expect(find({ pclass, constant, day })).toEqual([]);
  });
});

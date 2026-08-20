import { describe, expect, it } from 'vitest';
import { profileColumn } from '@/features/ml/data/profile';
import { analyzeTarget, baselineSuggestions, detectTask } from '@/features/ml/data/suggest';
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

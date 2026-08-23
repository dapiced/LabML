import { describe, expect, it } from 'vitest';
import { DEMO_DATASETS, resolveDemo } from './demos';

describe('resolveDemo', () => {
  it('accepts a known file name', () => {
    expect(resolveDemo('titanic.csv')).toBe('titanic.csv');
  });

  it('accepts the bare stem, which is what a doc link writes', () => {
    expect(resolveDemo('titanic')).toBe('titanic.csv');
    expect(resolveDemo('iris')).toBe('iris.csv');
  });

  it('returns null for nothing at all', () => {
    expect(resolveDemo(null)).toBeNull();
    expect(resolveDemo(undefined)).toBeNull();
    expect(resolveDemo('')).toBeNull();
  });

  it.each([
    '../../../etc/passwd',
    '/datasets/titanic.csv',
    'https://example.com/evil.csv',
    '..%2Ftitanic.csv',
    'titanic.csv.bak',
    'unknown.csv',
  ])('refuses %s — the value becomes a fetched path, so the list is the gate', (value) => {
    expect(resolveDemo(value)).toBeNull();
  });

  it('covers every shipped demo, so a new dataset cannot be deep-linked by accident', () => {
    for (const demo of DEMO_DATASETS) expect(resolveDemo(demo.file)).toBe(demo.file);
  });
});

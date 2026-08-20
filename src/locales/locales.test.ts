import { describe, expect, it } from 'vitest';
import en from '@/locales/en.json';
import fr from '@/locales/fr.json';

function collectKeys(node: unknown, prefix = ''): string[] {
  if (typeof node === 'string') return [prefix];
  if (node !== null && typeof node === 'object') {
    return Object.entries(node).flatMap(([key, value]) =>
      collectKeys(value, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [];
}

function collectValues(node: unknown): string[] {
  if (typeof node === 'string') return [node];
  if (node !== null && typeof node === 'object') {
    return Object.values(node).flatMap(collectValues);
  }
  return [];
}

describe('locale resources', () => {
  it('expose exactly the same keys in English and French', () => {
    expect(collectKeys(fr).sort()).toEqual(collectKeys(en).sort());
  });

  it('contain no empty strings', () => {
    expect(collectValues(en).every((value) => value.trim().length > 0)).toBe(true);
    expect(collectValues(fr).every((value) => value.trim().length > 0)).toBe(true);
  });
});

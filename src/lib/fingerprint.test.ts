import { describe, expect, it } from 'vitest';
import { fingerprint } from '@/lib/fingerprint';

describe('fingerprint', () => {
  it('is eight hexadecimal digits, the same for the same text', () => {
    expect(fingerprint('SELECT 1')).toMatch(/^[0-9a-f]{8}$/);
    expect(fingerprint('SELECT 1')).toBe(fingerprint('SELECT 1'));
    expect(fingerprint('')).toBe('811c9dc5');
  });

  it('tells two texts apart', () => {
    expect(fingerprint('SELECT 1')).not.toBe(fingerprint('SELECT 2'));
  });
});

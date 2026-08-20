import { beforeEach, describe, expect, it } from 'vitest';
import { getStoredTheme, resolveIsDark, storeTheme, THEME_STORAGE_KEY } from '@/lib/theme';

describe('resolveIsDark', () => {
  it('honors an explicit preference regardless of the system', () => {
    expect(resolveIsDark('dark', false)).toBe(true);
    expect(resolveIsDark('dark', true)).toBe(true);
    expect(resolveIsDark('light', false)).toBe(false);
    expect(resolveIsDark('light', true)).toBe(false);
  });

  it('follows the system when the preference is "system"', () => {
    expect(resolveIsDark('system', true)).toBe(true);
    expect(resolveIsDark('system', false)).toBe(false);
  });
});

describe('theme persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to "system" when nothing is stored', () => {
    expect(getStoredTheme()).toBe('system');
  });

  it('round-trips explicit preferences', () => {
    storeTheme('dark');
    expect(getStoredTheme()).toBe('dark');
    storeTheme('light');
    expect(getStoredTheme()).toBe('light');
  });

  it('clears storage when going back to "system"', () => {
    storeTheme('dark');
    storeTheme('system');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(getStoredTheme()).toBe('system');
  });

  it('ignores corrupted stored values', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'neon');
    expect(getStoredTheme()).toBe('system');
  });
});

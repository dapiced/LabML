export type ThemePreference = 'light' | 'dark' | 'system';

export const THEME_STORAGE_KEY = 'labml-theme';

export function resolveIsDark(preference: ThemePreference, systemPrefersDark: boolean): boolean {
  if (preference === 'dark') return true;
  if (preference === 'light') return false;
  return systemPrefersDark;
}

export function getStoredTheme(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

export function storeTheme(preference: ThemePreference): void {
  try {
    if (preference === 'system') {
      localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      localStorage.setItem(THEME_STORAGE_KEY, preference);
    }
  } catch {
    /* storage unavailable: theme simply won't persist */
  }
}

export function applyTheme(preference: ThemePreference): void {
  const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle('dark', resolveIsDark(preference, systemPrefersDark));
}

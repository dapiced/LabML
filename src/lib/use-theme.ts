import { useCallback, useEffect, useState } from 'react';
import { applyTheme, getStoredTheme, storeTheme, type ThemePreference } from '@/lib/theme';

export function useTheme() {
  const [theme, setThemeState] = useState<ThemePreference>(getStoredTheme);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [theme]);

  const setTheme = useCallback((preference: ThemePreference) => {
    storeTheme(preference);
    setThemeState(preference);
  }, []);

  return { theme, setTheme };
}

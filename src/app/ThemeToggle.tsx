import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/lib/use-theme';
import type { ThemePreference } from '@/lib/theme';

const ORDER: ThemePreference[] = ['light', 'dark', 'system'];

const ICONS = {
  light: Sun,
  dark: Moon,
  system: Monitor,
} as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation();
  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
  const Icon = ICONS[theme];

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={t('common.theme.toggle')}
      title={t(`common.theme.${theme}`)}
      data-theme-preference={theme}
      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface text-ink transition-colors hover:bg-surface-2"
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

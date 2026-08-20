import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

const LANGUAGES = ['en', 'fr'] as const;

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const current = i18n.resolvedLanguage ?? 'en';

  return (
    <div
      role="group"
      aria-label={t('common.language.label')}
      className="inline-flex rounded-full border border-line bg-surface p-0.5"
    >
      {LANGUAGES.map((lng) => (
        <button
          key={lng}
          type="button"
          onClick={() => void i18n.changeLanguage(lng)}
          aria-pressed={current === lng}
          aria-label={t(`common.language.${lng}`)}
          className={cn(
            'rounded-full px-2.5 py-1 font-mono text-xs tracking-wider uppercase transition-colors',
            current === lng ? 'bg-accent-soft text-accent-strong' : 'text-muted hover:text-ink',
          )}
        >
          {lng}
        </button>
      ))}
    </div>
  );
}

import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router';
import { LanguageSwitcher } from '@/app/LanguageSwitcher';
import { ThemeToggle } from '@/app/ThemeToggle';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

function navLinkClass({ isActive }: { isActive: boolean }) {
  return cn(
    'rounded-full px-3 py-1.5 text-sm whitespace-nowrap transition-colors',
    isActive ? 'bg-accent-soft font-medium text-accent-strong' : 'text-muted hover:text-ink',
  );
}

export function Header() {
  const { t } = useTranslation();

  return (
    <header className="sticky top-0 z-10 border-b border-line bg-bg/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <NavLink to="/" className="flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="h-8 w-8 rounded-lg" />
          <span className="leading-tight">
            <span className="block font-display text-lg font-bold">{t('common.appName')}</span>
            <span className="block font-mono text-[0.6rem] tracking-[0.14em] text-muted uppercase">
              {t('common.tagline')}
            </span>
          </span>
        </NavLink>

        <nav
          aria-label={t('common.appName')}
          className="order-last -mx-4 flex w-[calc(100%+2rem)] items-center gap-1 overflow-x-auto px-4 sm:order-none sm:mx-0 sm:w-auto sm:flex-1 sm:justify-center sm:px-0"
        >
          <NavLink to="/" end className={navLinkClass}>
            {t('common.nav.home')}
          </NavLink>
          <NavLink to="/ml" className={navLinkClass}>
            {t('common.nav.mlLab')}
          </NavLink>
          <NavLink to="/data" className={navLinkClass}>
            <span className="inline-flex items-center gap-1.5">
              {t('common.nav.data')}
              <Badge variant="outline">{t('common.soon')}</Badge>
            </span>
          </NavLink>
          <NavLink to="/ai" className={navLinkClass}>
            {t('common.nav.ai')}
          </NavLink>
        </nav>

        <div className="ml-auto flex items-center gap-2 sm:ml-0">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

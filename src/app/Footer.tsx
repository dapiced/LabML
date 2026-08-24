import { ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

export function Footer() {
  const { t } = useTranslation();

  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-6 text-sm text-muted">
        <p className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          {t('common.privacyStrip')}
        </p>
        {/*
          V35 wave 4 — `flex-wrap` here, not just on the row above.

          The outer row wraps; this inner one did not, so its four links and
          three separators stayed on a single 392 px line. Measured at 375 px:
          the WHOLE PAGE scrolled sideways by 33 px, on every route of the site.

          It only happened in French. The same row in English fits, which is why
          it shipped: the e2e suite declares a viewport and a colour scheme but
          no locale, so every test in the repository has always run against the
          English UI. French is the longer language and the one the author
          writes in — the exact place a layout gives way. See the `mobile-fr`
          project in `playwright.config.ts`, added with this fix.
        */}
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link
            to="/privacy"
            className="underline decoration-line underline-offset-4 hover:text-ink"
          >
            {t('common.footer.privacy')}
          </Link>
          <span aria-hidden="true">·</span>
          <Link to="/about" className="underline decoration-line underline-offset-4 hover:text-ink">
            {t('common.footer.about')}
          </Link>
          <span aria-hidden="true">·</span>
          <Link to="/docs" className="underline decoration-line underline-offset-4 hover:text-ink">
            {t('common.footer.docs')}
          </Link>
          <span aria-hidden="true">·</span>
          <span>{t('common.footer.copyright')}</span>
        </p>
      </div>
    </footer>
  );
}

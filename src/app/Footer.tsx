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
        <p className="flex items-center gap-3">
          <Link to="/about" className="underline decoration-line underline-offset-4 hover:text-ink">
            {t('common.footer.about')}
          </Link>
          <span aria-hidden="true">·</span>
          <span>{t('common.footer.copyright')}</span>
          <span aria-hidden="true">·</span>
          <a
            href="https://github.com/dapiced/LabML"
            target="_blank"
            rel="noreferrer"
            className="underline decoration-line underline-offset-4 hover:text-ink"
          >
            {t('common.footer.sourceCode')}
          </a>
        </p>
      </div>
    </footer>
  );
}

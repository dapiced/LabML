import { Braces, Database, FlaskConical } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Card } from '@/components/ui/card';
import { Eyebrow } from '@/components/ui/eyebrow';

/**
 * V41 — `1.<wave>.0`: the minor is the latest delivered wave, kept there by
 * `npm run changelog` and pinned to PLAN.md by its test. The card used to say
 * « the three modules are live », a sentence written at V22 and untouched
 * through the eighteen waves that followed.
 */
const LATEST_WAVE = `V${__APP_VERSION__.split('.')[1]}`;
const CHANGELOG_URL = 'https://github.com/dapiced/LabML/blob/main/CHANGELOG.md';

export function HomePage() {
  const { t } = useTranslation();

  return (
    <div className="mx-auto max-w-6xl px-4">
      <section className="py-16 sm:py-24">
        <Eyebrow>{t('home.eyebrow')}</Eyebrow>
        <h1 className="mt-3 max-w-3xl font-display text-4xl font-bold text-balance sm:text-6xl">
          {t('home.titlePre')}{' '}
          <span className="bg-accent-soft box-decoration-clone px-1 text-accent-strong">
            {t('home.titleHighlight')}
          </span>
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-muted">{t('home.lede')}</p>
      </section>

      <section className="grid gap-4 pb-16 sm:grid-cols-3">
        <Card className="flex flex-col gap-3">
          <FlaskConical className="h-6 w-6 text-accent" aria-hidden="true" />
          <h2 className="font-display text-xl font-semibold">
            <Link to="/ml" className="hover:underline">
              {t('home.modules.ml.title')}
            </Link>
          </h2>
          <p className="text-sm text-muted">{t('home.modules.ml.description')}</p>
        </Card>
        <Card className="flex flex-col gap-3">
          <Database className="h-6 w-6 text-accent" aria-hidden="true" />
          <h2 className="font-display text-xl font-semibold">
            <Link to="/data" className="hover:underline">
              {t('home.modules.data.title')}
            </Link>
          </h2>
          <p className="text-sm text-muted">{t('home.modules.data.description')}</p>
        </Card>
        <Card className="flex flex-col gap-3">
          <Braces className="h-6 w-6 text-accent" aria-hidden="true" />
          <h2 className="font-display text-xl font-semibold">
            <Link to="/ai" className="hover:underline">
              {t('home.modules.ai.title')}
            </Link>
          </h2>
          <p className="text-sm text-muted">{t('home.modules.ai.description')}</p>
        </Card>
      </section>

      <section className="pb-20">
        <Card className="bg-surface-2">
          <Eyebrow>{t('home.statusTitle')}</Eyebrow>
          <p className="mt-2 max-w-3xl text-sm text-muted">{t('home.statusBody')}</p>
          <p className="mt-3 text-sm text-muted">
            {t('home.latestWave')} <strong className="font-medium text-ink">{LATEST_WAVE}</strong>
            {' · '}
            <a
              href={CHANGELOG_URL}
              className="underline decoration-line underline-offset-4 hover:text-ink"
            >
              {t('home.changelog')}
            </a>
          </p>
        </Card>
      </section>
    </div>
  );
}

export default HomePage;

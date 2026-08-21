import { Database, ExternalLink, Link2, ShieldCheck, WifiOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/card';
import { Eyebrow } from '@/components/ui/eyebrow';

const PRIVACY_CARDS = [
  { key: 'local', Icon: ShieldCheck },
  { key: 'storage', Icon: Database },
  { key: 'share', Icon: Link2 },
  { key: 'offline', Icon: WifiOff },
] as const;

export function AboutPage() {
  const { t } = useTranslation();

  return (
    <div className="mx-auto max-w-6xl px-4">
      <section className="py-16 sm:py-20">
        <Eyebrow>{t('about.eyebrow')}</Eyebrow>
        <h1 className="mt-3 max-w-3xl font-display text-3xl font-bold text-balance sm:text-5xl">
          {t('about.title')}
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-muted">{t('about.lede')}</p>
      </section>

      <section className="pb-12">
        <Card>
          <Eyebrow>{t('about.how.title')}</Eyebrow>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">{t('about.how.body')}</p>
        </Card>
      </section>

      <section className="pb-12">
        <h2 className="mb-4 font-display text-2xl font-semibold">{t('about.privacy.title')}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {PRIVACY_CARDS.map(({ key, Icon }) => (
            <Card key={key} className="flex flex-col gap-2">
              <Icon className="h-5 w-5 text-accent" aria-hidden="true" />
              <h3 className="font-display text-lg font-semibold">
                {t(`about.privacy.${key}.title`)}
              </h3>
              <p className="text-sm text-muted">{t(`about.privacy.${key}.body`)}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="pb-20">
        <Card className="flex flex-col gap-2 bg-surface-2">
          <Eyebrow>{t('about.openSource.title')}</Eyebrow>
          <p className="max-w-3xl text-sm text-muted">{t('about.openSource.body')}</p>
          <a
            href="https://github.com/dapiced/LabML"
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex w-fit items-center gap-2 text-sm font-medium text-accent-strong hover:underline"
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            {t('about.openSource.cta')}
          </a>
        </Card>
      </section>
    </div>
  );
}

export default AboutPage;

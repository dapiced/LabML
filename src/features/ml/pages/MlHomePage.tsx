import { FileUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Eyebrow } from '@/components/ui/eyebrow';

const STEP_KEYS = ['upload', 'target', 'train', 'read'] as const;
const DEMO_DATASETS = ['iris.csv', 'titanic.csv', 'housing.csv'];
const ROADMAP_KEYS = ['sprint0', 'sprint1', 'sprint2', 'sprint3'] as const;

export function MlHomePage() {
  const { t } = useTranslation();

  return (
    <div className="mx-auto max-w-6xl px-4">
      <section className="py-16 sm:py-20">
        <Eyebrow>{t('ml.eyebrow')}</Eyebrow>
        <h1 className="mt-3 max-w-3xl font-display text-3xl font-bold text-balance sm:text-5xl">
          {t('ml.titlePre')}{' '}
          <span className="bg-accent-soft box-decoration-clone px-1 text-accent-strong">
            {t('ml.titleHighlight')}
          </span>
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-muted">{t('ml.lede')}</p>
      </section>

      <section className="grid gap-4 pb-12 sm:grid-cols-2 lg:grid-cols-4">
        {STEP_KEYS.map((key, index) => (
          <Card key={key} className="flex flex-col gap-2">
            <span className="font-mono text-sm text-copper">0{index + 1}</span>
            <h2 className="font-display text-lg font-semibold">{t(`ml.steps.${key}.title`)}</h2>
            <p className="text-sm text-muted">{t(`ml.steps.${key}.description`)}</p>
          </Card>
        ))}
      </section>

      <section className="grid gap-4 pb-20 lg:grid-cols-[3fr_2fr]">
        <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-line bg-surface p-10 text-center">
          <FileUp className="h-8 w-8 text-accent" aria-hidden="true" />
          <h2 className="font-display text-xl font-semibold">{t('ml.dropzone.title')}</h2>
          <p className="max-w-md text-sm text-muted">{t('ml.dropzone.description')}</p>
          <div className="flex flex-col items-center gap-2 pt-2">
            <Eyebrow>{t('ml.dropzone.demoLabel')}</Eyebrow>
            <div className="flex flex-wrap justify-center gap-2">
              {DEMO_DATASETS.map((name) => (
                <span
                  key={name}
                  className="rounded-md border border-line bg-surface-2 px-2 py-1 font-mono text-xs text-muted"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        </div>

        <Card>
          <Eyebrow>{t('ml.roadmap.title')}</Eyebrow>
          <ul className="mt-4 flex flex-col gap-3">
            {ROADMAP_KEYS.map((key, index) => (
              <li key={key} className="flex items-start gap-3 text-sm">
                <Badge variant={index === 0 ? 'accent' : 'outline'} className="mt-0.5 shrink-0">
                  S{index}
                </Badge>
                <span className={index === 0 ? 'text-ink' : 'text-muted'}>
                  {t(`ml.roadmap.${key}`)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </section>
    </div>
  );
}

export default MlHomePage;

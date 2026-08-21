import { Suspense, lazy } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/card';
import { Eyebrow } from '@/components/ui/eyebrow';
import { LabSection } from '@/features/ml/components/LabSection';

const STEP_KEYS = ['upload', 'target', 'train', 'read'] as const;
// History (and Dexie with it) loads after first paint — it sits below the fold.
const RunsHistory = lazy(() => import('@/features/ml/components/RunsHistory'));

export function MlHomePage() {
  const { t } = useTranslation();

  return (
    <div className="mx-auto max-w-6xl px-4">
      <section className="py-12 sm:py-16">
        <Eyebrow>{t('ml.eyebrow')}</Eyebrow>
        <h1 className="mt-3 max-w-3xl font-display text-3xl font-bold text-balance sm:text-5xl">
          {t('ml.titlePre')}{' '}
          <span className="bg-accent-soft box-decoration-clone px-1 text-accent-strong">
            {t('ml.titleHighlight')}
          </span>
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-muted">{t('ml.lede')}</p>
      </section>

      <LabSection />

      <Suspense fallback={null}>
        <RunsHistory />
      </Suspense>

      <section className="grid gap-4 pb-20 sm:grid-cols-2 lg:grid-cols-4">
        {STEP_KEYS.map((key, index) => (
          <Card key={key} className="flex flex-col gap-2">
            <span className="font-mono text-sm text-copper">0{index + 1}</span>
            <h2 className="font-display text-lg font-semibold">{t(`ml.steps.${key}.title`)}</h2>
            <p className="text-sm text-muted">{t(`ml.steps.${key}.description`)}</p>
          </Card>
        ))}
      </section>
    </div>
  );
}

export default MlHomePage;

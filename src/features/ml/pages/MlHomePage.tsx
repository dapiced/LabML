import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Eyebrow } from '@/components/ui/eyebrow';
import { LabSection } from '@/features/ml/components/LabSection';
import { RunsHistory } from '@/features/ml/components/RunsHistory';

const STEP_KEYS = ['upload', 'target', 'train', 'read'] as const;
const ROADMAP_KEYS = [
  'sprint0',
  'sprint1',
  'sprint2',
  'sprint3',
  'sprint4',
  'sprint5',
  'v2',
  'v3',
] as const;
const SHIPPED_SPRINTS = 8; // MVP (S0–S5) + V2 models + V3 vision are live

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

      <RunsHistory />

      <section className="grid gap-4 pb-12 sm:grid-cols-2 lg:grid-cols-4">
        {STEP_KEYS.map((key, index) => (
          <Card key={key} className="flex flex-col gap-2">
            <span className="font-mono text-sm text-copper">0{index + 1}</span>
            <h2 className="font-display text-lg font-semibold">{t(`ml.steps.${key}.title`)}</h2>
            <p className="text-sm text-muted">{t(`ml.steps.${key}.description`)}</p>
          </Card>
        ))}
      </section>

      <section className="pb-20">
        <Card>
          <Eyebrow>{t('ml.roadmap.title')}</Eyebrow>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {ROADMAP_KEYS.map((key, index) => (
              <li key={key} className="flex items-start gap-3 text-sm">
                <Badge
                  variant={index < SHIPPED_SPRINTS ? 'accent' : 'outline'}
                  className="mt-0.5 shrink-0"
                >
                  {key.startsWith('v') ? key.toUpperCase() : `S${index}`}
                </Badge>
                <span className={index < SHIPPED_SPRINTS ? 'text-ink' : 'text-muted'}>
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

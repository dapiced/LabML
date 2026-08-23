import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Eyebrow } from '@/components/ui/eyebrow';
import { ExportBar } from '@/features/ml/components/ExportBar';
import { ConfusionMatrix } from '@/features/ml/components/insights/ConfusionMatrix';
import { ImportanceBars } from '@/features/ml/components/insights/ImportanceBars';
import { PdpChart } from '@/features/ml/components/insights/PdpChart';
import { PlainRead } from '@/features/ml/components/insights/PlainRead';
import {
  ResidualsChart,
  ScatterPlot,
} from '@/features/ml/components/insights/RegressionDiagnostics';
import { RocCurve } from '@/features/ml/components/insights/RocCurve';
import { WordEffects } from '@/features/ml/components/insights/WordEffects';
import { WhatIfPanel } from '@/features/ml/components/insights/WhatIfPanel';
import { useLabStore } from '@/features/ml/lab-store';

export function InsightsSection() {
  const { t } = useTranslation();
  const trainStatus = useLabStore((s) => s.trainStatus);
  const insights = useLabStore((s) => s.insights);
  const summary = useLabStore((s) => s.summary);
  if (trainStatus !== 'done' || !summary) return null;

  if (!insights) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden="true" />
        {t('ml.lab.insights.loading')}
      </p>
    );
  }

  const isClassification = summary.taskType !== 'regression';

  return (
    <section data-testid="insights" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <Eyebrow>
          {t('ml.lab.insights.title')} · {t(`ml.lab.models.${insights.model}`)}
        </Eyebrow>
        <span className="text-xs text-muted">{t('ml.lab.insights.selectHint')}</span>
      </div>

      <PlainRead />

      <ExportBar />

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {insights.classes && insights.confusion && (
          <ConfusionMatrix classes={insights.classes} matrix={insights.confusion} />
        )}
        {insights.roc && <RocCurve points={insights.roc.points} auc={insights.roc.auc} />}
        {insights.scatter && <ScatterPlot points={insights.scatter} />}
        {insights.residuals && <ResidualsChart residuals={insights.residuals} />}
        <ImportanceBars importance={insights.importance} isClassification={isClassification} />
        {((insights.words && insights.words.length > 0) || insights.wordsRefused) && (
          <WordEffects
            words={insights.words ?? []}
            isClassification={isClassification}
            positiveClass={insights.classes?.[1]}
            refusal={insights.wordsRefused}
          />
        )}
        {insights.pdp?.map(({ column, points }) => (
          <PdpChart key={column} column={column} points={points} />
        ))}
      </div>

      <WhatIfPanel key={`${insights.model}:${summary.featureColumns.join('|')}`} />
    </section>
  );
}

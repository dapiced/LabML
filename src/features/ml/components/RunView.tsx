import { MessageSquareText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Eyebrow } from '@/components/ui/eyebrow';
import { LeaderboardTable } from '@/features/ml/components/LeaderboardTable';
import { ConfusionMatrix } from '@/features/ml/components/insights/ConfusionMatrix';
import { ImportanceBars } from '@/features/ml/components/insights/ImportanceBars';
import {
  ResidualsChart,
  ScatterPlot,
} from '@/features/ml/components/insights/RegressionDiagnostics';
import { RocCurve } from '@/features/ml/components/insights/RocCurve';
import { buildPlainRead } from '@/features/ml/projects/report';
import type { RunRecord } from '@/features/ml/projects/types';

/** Read-only rendering of a saved or shared run — metrics only, never data. */
export function RunView({ record }: { record: RunRecord }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? 'en';
  const read = buildPlainRead(record, t, lang);
  const isClassification = record.taskType !== 'regression';
  const { insights } = record;

  return (
    <div data-testid="run-view" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="font-display text-lg font-semibold">{record.name}</span>
        <span className="font-mono text-xs text-muted tabular-nums">
          {record.dataset.name} · {record.dataset.rowCount.toLocaleString(lang)} ×{' '}
          {record.dataset.columnCount} · {new Date(record.createdAt).toLocaleString(lang)}
        </span>
        <Badge>
          {t(`ml.lab.task.${record.taskType}`, { count: insights.classes?.length ?? 0 })}
        </Badge>
      </div>

      {read && (
        <div className="flex flex-col gap-2 rounded-2xl bg-surface-2 p-5">
          <Eyebrow className="flex items-center gap-2">
            <MessageSquareText className="h-3.5 w-3.5" aria-hidden="true" />
            {t('ml.lab.insights.readTitle')}
          </Eyebrow>
          <p className="max-w-3xl text-sm leading-relaxed">{read}</p>
        </div>
      )}

      <LeaderboardTable
        results={record.results}
        summary={record.summary}
        taskType={record.taskType}
        inspectedModel={insights.model}
      />

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {insights.classes && insights.confusion && (
          <ConfusionMatrix classes={insights.classes} matrix={insights.confusion} />
        )}
        {insights.roc && <RocCurve points={insights.roc.points} auc={insights.roc.auc} />}
        {insights.scatter && <ScatterPlot points={insights.scatter} />}
        {insights.residuals && <ResidualsChart residuals={insights.residuals} />}
        <ImportanceBars importance={insights.importance} isClassification={isClassification} />
      </div>
    </div>
  );
}

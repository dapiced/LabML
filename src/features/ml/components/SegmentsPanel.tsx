import { Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Eyebrow } from '@/components/ui/eyebrow';
import { useLabStore } from '@/features/ml/lab-store';

/**
 * Per-segment metrics of the inspected model: the held-out test set sliced by
 * every categorical column — including those kept OUT of the features, where
 * proxy effects surface. Gaps are findings to investigate, not verdicts.
 */
export function SegmentsPanel() {
  const { t, i18n } = useTranslation();
  const analysis = useLabStore((s) => s.segmentAnalysis);
  if (!analysis) return null;

  const lang = i18n.resolvedLanguage ?? 'en';
  const metricName = t(`ml.lab.leaderboard.${analysis.metricLabel}`);
  // Low accuracy hurts; high RMSE hurts.
  const harmful = (delta: number) => (analysis.isClassification ? delta < 0 : delta > 0);

  return (
    <section
      data-testid="segments-panel"
      className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4"
    >
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Users className="h-4 w-4 text-accent" aria-hidden="true" />
          <Eyebrow>{t('ml.lab.segments.title')}</Eyebrow>
          <Badge variant="outline" className="font-mono">
            {metricName} {analysis.overall.toFixed(3)}
          </Badge>
          <Badge variant="outline">{t(`ml.lab.models.${analysis.model}`)}</Badge>
        </div>
        <p className="mt-1 max-w-3xl text-xs text-muted">
          {t('ml.lab.segments.hint', {
            rows: analysis.testRows.toLocaleString(lang),
            min: analysis.minRows,
          })}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {analysis.columns.map((column) => (
          <div
            key={column.column}
            data-testid={`segments-column-${column.column}`}
            className="flex flex-col gap-2 rounded-xl bg-surface-2 p-3"
          >
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
              <span className="font-mono">{column.column}</span>
              <Badge variant="outline" className="text-[0.62rem]">
                {column.inFeatures
                  ? t('ml.lab.segments.inFeatures')
                  : t('ml.lab.segments.outFeatures')}
              </Badge>
            </p>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th className="py-1 pr-3 font-normal">{t('ml.lab.segments.colSegment')}</th>
                  <th className="py-1 pr-3 font-normal">{t('ml.lab.segments.colRows')}</th>
                  <th className="py-1 pr-3 font-normal">{metricName}</th>
                  <th className="py-1 font-normal">{t('ml.lab.segments.colDelta')}</th>
                </tr>
              </thead>
              <tbody>
                {column.segments.map((segment) => (
                  <tr key={segment.value} className="border-b border-line last:border-b-0">
                    <td className="max-w-40 truncate py-1 pr-3" title={segment.value}>
                      {segment.value}
                    </td>
                    <td className="py-1 pr-3 font-mono tabular-nums text-muted">{segment.rows}</td>
                    <td className="py-1 pr-3 font-mono tabular-nums">
                      {segment.metric.toFixed(3)}
                    </td>
                    <td
                      className={`py-1 font-mono tabular-nums ${
                        harmful(segment.delta) ? 'text-copper' : 'text-ok'
                      }`}
                    >
                      {segment.delta >= 0 ? '+' : ''}
                      {segment.delta.toFixed(3)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {column.smallSegments > 0 && (
              <p className="text-[0.68rem] text-muted">
                {t('ml.lab.segments.small', {
                  count: column.smallSegments,
                  min: analysis.minRows,
                })}
              </p>
            )}
          </div>
        ))}
      </div>

      <p className="text-xs text-muted">{t('ml.lab.segments.note')}</p>
    </section>
  );
}

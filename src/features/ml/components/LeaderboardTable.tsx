import { Eye } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import type { TaskType } from '@/features/ml/data/types';
import type { ModelResult, TrainSummary } from '@/features/ml/train/types';
import { cn } from '@/lib/utils';

function formatMetric(value: number | undefined, digits = 3): string {
  return value === undefined || Number.isNaN(value) ? '—' : value.toFixed(digits);
}

function formatMs(value: number): string {
  if (value < 0.05) return '<0.1';
  return value >= 100 ? String(Math.round(value)) : value.toFixed(1);
}

interface LeaderboardTableProps {
  results: ModelResult[];
  summary: TrainSummary | null;
  taskType: TaskType;
  inspectedModel?: ModelResult['key'] | null;
  onSelectModel?: (model: ModelResult['key']) => void;
}

/**
 * Presentational model ranking — used live in the lab and read-only in
 * stored/shared run views. Classification ranks by accuracy (higher wins),
 * regression by RMSE (lower wins), with the delta vs baseline made explicit.
 */
export function LeaderboardTable({
  results,
  summary,
  taskType,
  inspectedModel,
  onSelectModel,
}: LeaderboardTableProps) {
  const { t } = useTranslation();
  const isClassification = taskType !== 'regression';
  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const sorted = [...ok].sort((a, b) =>
    isClassification ? b.primary - a.primary : a.primary - b.primary,
  );
  const baseline = ok.find((r) => r.key === 'baseline');
  const bestKey = sorted[0]?.key;
  const maxPrimary = Math.max(...ok.map((r) => r.primary), 1e-9);

  const metricColumns: { key: keyof ModelResult['metrics']; label: string }[] = isClassification
    ? [
        { key: 'f1', label: t('ml.lab.leaderboard.f1') },
        { key: 'auc', label: t('ml.lab.leaderboard.auc') },
        { key: 'logLoss', label: t('ml.lab.leaderboard.logLoss') },
      ]
    : [
        { key: 'mae', label: t('ml.lab.leaderboard.mae') },
        { key: 'r2', label: t('ml.lab.leaderboard.r2') },
      ];

  function delta(result: ModelResult): string {
    if (!baseline || result.key === 'baseline') return '—';
    const value = isClassification
      ? result.primary - baseline.primary
      : baseline.primary - result.primary;
    const sign = value > 0 ? '+' : '';
    return `${sign}${value.toFixed(3)}`;
  }

  return (
    <div
      data-testid="leaderboard"
      className="overflow-x-auto rounded-2xl border border-line bg-surface"
    >
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="bg-surface-2 font-mono text-[0.68rem] tracking-wider uppercase">
            <th className="px-3 py-2 font-medium">#</th>
            <th className="px-3 py-2 font-medium">{t('ml.lab.leaderboard.model')}</th>
            <th className="px-3 py-2 font-medium">
              {isClassification ? t('ml.lab.leaderboard.accuracy') : t('ml.lab.leaderboard.rmse')}
            </th>
            <th className="px-3 py-2 font-medium">{t('ml.lab.leaderboard.delta')}</th>
            {metricColumns.map(({ key, label }) => (
              <th key={key} className="px-3 py-2 font-medium">
                {label}
              </th>
            ))}
            <th className="px-3 py-2 font-medium">{t('ml.lab.leaderboard.trainTime')}</th>
            <th className="px-3 py-2 font-medium">{t('ml.lab.leaderboard.inference')}</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {sorted.map((result, rank) => (
            <tr
              key={result.key}
              onClick={onSelectModel ? () => onSelectModel(result.key) : undefined}
              title={onSelectModel ? t('ml.lab.insights.inspectRow') : undefined}
              className={cn(
                'border-t border-line transition-colors',
                onSelectModel && 'cursor-pointer hover:bg-surface-2',
                result.key === bestKey && 'bg-accent-soft/50',
                result.key === 'baseline' && 'text-muted',
              )}
            >
              <td className="px-3 py-2 font-mono text-xs">{rank + 1}</td>
              <td className="px-3 py-2">
                <span className="flex items-center gap-2 whitespace-nowrap">
                  {t(`ml.lab.models.${result.key}`)}
                  {result.key === bestKey && <Badge>{t('ml.lab.leaderboard.best')}</Badge>}
                  {result.key === 'baseline' && (
                    <Badge variant="outline">{t('ml.lab.leaderboard.baselineTag')}</Badge>
                  )}
                  {inspectedModel === result.key && (
                    <Eye className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                  )}
                </span>
              </td>
              <td className="px-3 py-2">
                <span className="flex items-center gap-2">
                  {isClassification && (
                    <span className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-surface-2">
                      <span
                        className="block h-full rounded-full bg-accent/75"
                        style={{ width: `${(result.primary / maxPrimary) * 100}%` }}
                      />
                    </span>
                  )}
                  <span className="font-medium">{formatMetric(result.primary)}</span>
                </span>
              </td>
              <td
                className={cn(
                  'px-3 py-2',
                  delta(result).startsWith('+') && 'font-medium text-accent-strong',
                )}
              >
                {delta(result)}
              </td>
              {metricColumns.map(({ key }) => (
                <td key={key} className="px-3 py-2">
                  {formatMetric(result.metrics[key])}
                </td>
              ))}
              <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                {formatMs(result.trainMs)} ms
              </td>
              <td
                className="px-3 py-2 font-mono text-xs whitespace-nowrap"
                title={t('ml.lab.leaderboard.inferenceTitle', {
                  value: formatMs(result.inferP95Ms),
                })}
              >
                {formatMs(result.inferP50Ms)} ms
              </td>
            </tr>
          ))}
          {failed.map((result) => (
            <tr key={result.key} className="border-t border-line text-muted">
              <td className="px-3 py-2 font-mono text-xs">—</td>
              <td className="px-3 py-2">
                <span className="flex items-center gap-2 whitespace-nowrap">
                  {t(`ml.lab.models.${result.key}`)}
                  <Badge variant="copper">{t('ml.lab.leaderboard.failed')}</Badge>
                </span>
              </td>
              <td className="px-3 py-2" colSpan={4 + metricColumns.length}>
                <span className="font-mono text-xs">{result.error}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {summary && (
        <p className="border-t border-line px-3 py-2 font-mono text-[0.68rem] text-muted">
          {t('ml.lab.leaderboard.runInfo', {
            seed: summary.seed,
            train: summary.trainRows,
            test: summary.testRows,
            features: summary.featureCount,
          })}
          {summary.skippedColumns.length > 0 && (
            <>
              {' '}
              · {t('ml.lab.leaderboard.skipped', { columns: summary.skippedColumns.join(', ') })}
            </>
          )}
        </p>
      )}
    </div>
  );
}

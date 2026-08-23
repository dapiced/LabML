import { AlertTriangle, Eye } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import {
  championGap,
  defaultMetric,
  METRIC_DIRECTION,
  rankableMetrics,
  rankingValue,
  sortResults,
} from '@/features/ml/train/ranking';
import type { TaskType } from '@/features/ml/data/types';
import type { ModelResult, RankingMetric, TrainSummary } from '@/features/ml/train/types';
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
  /** V36: the metric the table ranks on. Undefined = the task's default. */
  rankMetric?: RankingMetric | null;
  onRankMetric?: (metric: RankingMetric | null) => void;
}

/**
 * Presentational model ranking — used live in the lab and read-only in
 * stored/shared run views. Classification ranks by accuracy (higher wins),
 * regression by RMSE (lower wins), with the delta vs baseline made explicit.
 *
 * V35: when a run carries validation scores, the table ranks and crowns on
 * the VALIDATION metric and shows the test metric beside it — selecting on
 * the reporting set made the crowned number the optimistic max of nine
 * draws. The champion line spells out the val→test gap: that gap is the
 * most useful lesson the lab can teach. Runs stored before V35 carry no
 * validation scores and keep their historical, test-ranked display.
 */
export function LeaderboardTable({
  results,
  summary,
  taskType,
  inspectedModel,
  onSelectModel,
  rankMetric,
  onRankMetric,
}: LeaderboardTableProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? 'en';
  const isClassification = taskType !== 'regression';
  const failed = results.filter((r) => !r.ok);
  // V36: rank on the chosen metric — accuracy is the wrong criterion on an
  // imbalanced target, and the order genuinely changes with the choice.
  const metric = rankMetric ?? undefined;
  const sorted = sortResults(results, taskType, metric);
  const baseline = sorted.find((r) => r.key === 'baseline');
  const bestKey = sorted[0]?.key;
  const hasValidation = sorted.some((r) => r.valPrimary !== undefined);
  const champion = championGap(results, taskType, metric);
  const maxPrimary = Math.max(...sorted.map((r) => Math.abs(rankingValue(r, metric))), 1e-9);
  const leakWarnings = summary?.leakWarnings ?? [];

  const metricsOf = (result: ModelResult) =>
    hasValidation ? (result.valMetrics ?? result.metrics) : result.metrics;

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
    // The delta follows the METRIC's direction, not the task's — ranking on
    // RMSE and on R² point opposite ways within the same regression run.
    const higherWins =
      metric === undefined ? isClassification : METRIC_DIRECTION[metric] === 'higher';
    const value = higherWins
      ? rankingValue(result, metric) - rankingValue(baseline, metric)
      : rankingValue(baseline, metric) - rankingValue(result, metric);
    const sign = value > 0 ? '+' : '';
    return `${sign}${value.toFixed(3)}`;
  }

  const activeMetric = metric ?? defaultMetric(taskType);
  const metricLabel = t(`ml.lab.metricNames.${activeMetric}`);
  const primaryHeader = hasValidation ? `${metricLabel} (val)` : metricLabel;

  return (
    <div
      data-testid="leaderboard"
      className="overflow-x-auto rounded-2xl border border-line bg-surface"
    >
      {onRankMetric && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 text-xs">
          <label className="flex items-center gap-2">
            {t('ml.lab.leaderboard.rankBy')}
            <select
              data-testid="rank-metric"
              className="rounded-lg border border-line bg-surface px-2 py-1 text-xs"
              value={activeMetric}
              onChange={(event) => {
                const chosen = event.target.value as RankingMetric;
                onRankMetric(chosen === defaultMetric(taskType) ? null : chosen);
              }}
            >
              {rankableMetrics(taskType).map((option) => (
                <option key={option} value={option}>
                  {t(`ml.lab.metricNames.${option}`)}
                </option>
              ))}
            </select>
          </label>
          {summary?.imbalanced && (
            <span className="text-muted" data-testid="imbalance-hint">
              {t('ml.lab.leaderboard.imbalanceHint', {
                share: ((summary.majorityShare ?? 0) * 100).toFixed(0),
              })}
            </span>
          )}
        </div>
      )}
      {leakWarnings.length > 0 && (
        <div
          data-testid="leak-warning"
          className="flex items-start gap-2 border-b border-line bg-copper-soft px-3 py-2.5 text-sm"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-copper" aria-hidden="true" />
          <div>
            {leakWarnings.map((warning) => (
              <p key={warning.column}>
                {t('ml.lab.leaderboard.leakWarning', {
                  column: warning.column,
                  score: (warning.score * 100).toFixed(1),
                })}
              </p>
            ))}
            <p className="text-xs text-muted">{t('ml.lab.leaderboard.leakAdvice')}</p>
          </div>
        </div>
      )}
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="bg-surface-2 font-mono text-[0.68rem] tracking-wider uppercase">
            <th className="px-3 py-2 font-medium">#</th>
            <th className="px-3 py-2 font-medium">{t('ml.lab.leaderboard.model')}</th>
            <th className="px-3 py-2 font-medium">{primaryHeader}</th>
            {hasValidation && (
              <th className="px-3 py-2 font-medium" title={t('ml.lab.leaderboard.testTitle')}>
                {t('ml.lab.leaderboard.test')}
              </th>
            )}
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
                        style={{ width: `${(rankingValue(result) / maxPrimary) * 100}%` }}
                      />
                    </span>
                  )}
                  <span className="font-medium">{formatMetric(rankingValue(result))}</span>
                </span>
              </td>
              {hasValidation && (
                <td className="px-3 py-2 text-muted">{formatMetric(result.primary)}</td>
              )}
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
                  {formatMetric(metricsOf(result)[key])}
                </td>
              ))}
              <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                {formatMs(result.trainMs)} ms
                {summary !== null &&
                  result.trainedRows !== undefined &&
                  result.trainedRows < summary.trainRows && (
                    <span
                      className="block text-[0.62rem] text-muted"
                      title={t('ml.lab.leaderboard.trainedOnTitle', {
                        rows: result.trainedRows.toLocaleString(lang),
                        total: summary.trainRows.toLocaleString(lang),
                      })}
                    >
                      {t('ml.lab.leaderboard.trainedOn', {
                        rows: result.trainedRows.toLocaleString(lang),
                      })}
                    </span>
                  )}
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
              <td
                className="px-3 py-2"
                colSpan={4 + metricColumns.length + (hasValidation ? 1 : 0)}
              >
                <span className="font-mono text-xs">{result.error}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {champion && (
        <p data-testid="champion-gap" className="border-t border-line px-3 py-2 text-xs">
          {t('ml.lab.leaderboard.championLine', {
            model: t(`ml.lab.models.${champion.model.key}`),
            val: formatMetric(champion.val),
            test: formatMetric(champion.test),
            gap: `${champion.gap > 0 ? '+' : ''}${champion.gap.toFixed(3)}`,
          })}{' '}
          <span className="text-muted">{t('ml.lab.leaderboard.championWhy')}</span>
        </p>
      )}
      {summary && (
        <p className="border-t border-line px-3 py-2 font-mono text-[0.68rem] text-muted">
          {summary.validationRows !== undefined
            ? t('ml.lab.leaderboard.runInfoVal', {
                seed: summary.seed,
                train: summary.trainRows,
                val: summary.validationRows,
                test: summary.testRows,
                features: summary.featureCount,
              })
            : t('ml.lab.leaderboard.runInfo', {
                seed: summary.seed,
                train: summary.trainRows,
                test: summary.testRows,
                features: summary.featureCount,
              })}
          {summary.split !== undefined && (
            <>
              {' '}
              ·{' '}
              {t(
                summary.split.mode === 'chronological'
                  ? 'ml.lab.leaderboard.splitChronological'
                  : 'ml.lab.leaderboard.splitGroup',
                { column: summary.split.column },
              )}
              {summary.split.dropped !== undefined &&
                ` ${t('ml.lab.leaderboard.splitDropped', { count: summary.split.dropped })}`}
            </>
          )}
          {summary.sampledFrom !== undefined && (
            <>
              {' '}
              ·{' '}
              {t('ml.lab.leaderboard.sampledFrom', {
                cap: (
                  summary.trainRows +
                  (summary.validationRows ?? 0) +
                  summary.testRows
                ).toLocaleString(lang),
                from: summary.sampledFrom.toLocaleString(lang),
              })}
            </>
          )}
          {summary.classWeighting !== undefined && (
            <>
              {' '}
              ·{' '}
              {t('ml.lab.leaderboard.weighting', {
                loss: 'logistic, gbdt',
                resample: 'tree, forest',
              })}
            </>
          )}
          {summary.ensemble !== undefined && (
            <>
              {' '}
              ·{' '}
              {t('ml.lab.leaderboard.ensembleNote', {
                members: summary.ensemble.members
                  .map((key) => t(`ml.lab.models.${key}`))
                  .join(', '),
              })}{' '}
              (
              {t(
                summary.ensemble.method === 'vote'
                  ? 'ml.lab.leaderboard.ensembleVote'
                  : summary.ensemble.method === 'mean'
                    ? 'ml.lab.leaderboard.ensembleMean'
                    : 'ml.lab.leaderboard.ensembleProbability',
              )}
              )
            </>
          )}
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

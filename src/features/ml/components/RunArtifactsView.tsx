import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Eyebrow } from '@/components/ui/eyebrow';
import { METRIC_ROWS, metricDelta } from '@/features/ml/train/score-view';
import type { RunArtifacts } from '@/features/ml/projects/types';
import type { ClusterTrait } from '@/features/ml/unsupervised/explore';

function ArtifactCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
      <Eyebrow>{title}</Eyebrow>
      {children}
    </div>
  );
}

function TraitLine({ trait }: { trait: ClusterTrait }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage;
  const num = (v: number) => v.toLocaleString(lang, { maximumFractionDigits: 2 });
  const pct = (v: number) => (v * 100).toLocaleString(lang, { maximumFractionDigits: 0 });
  return (
    <li className="text-xs text-muted">
      {trait.kind === 'numeric'
        ? t('ml.lab.explore.traitNumeric', {
            column: trait.column,
            clusterMean: num(trait.clusterMean),
            overallMean: num(trait.overallMean),
          })
        : t('ml.lab.explore.traitCategorical', {
            column: trait.column,
            value: trait.value,
            share: pct(trait.share),
            overallShare: pct(trait.overallShare),
          })}
    </li>
  );
}

/**
 * Read-only cards for the analyses that joined the run after training —
 * shown on stored and shared runs so the complete story survives the session.
 */
export function RunArtifactsView({ artifacts }: { artifacts: RunArtifacts }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? 'en';
  const { tuning, explanation, exploration, forecast, batchScore, threshold, segments } = artifacts;
  const { uncertainty } = artifacts;
  if (
    !tuning &&
    !explanation &&
    !exploration &&
    !forecast &&
    !batchScore &&
    !threshold &&
    !segments &&
    !uncertainty
  ) {
    return null;
  }
  const score = (v: number) =>
    v.toLocaleString(lang, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const tuningDelta =
    tuning && Number.isFinite(tuning.defaultPrimary)
      ? tuning.isClassification
        ? tuning.tunedPrimary - tuning.defaultPrimary
        : tuning.defaultPrimary - tuning.tunedPrimary
      : null;
  const maxContribution = explanation
    ? Math.max(...explanation.contributions.map((c) => Math.abs(c.value)), 1e-9)
    : 1;

  return (
    <div data-testid="run-artifacts" className="flex flex-col gap-3">
      <p className="text-xs text-muted">{t('ml.lab.runArtifacts.hint')}</p>
      <div className="grid gap-4 lg:grid-cols-2">
        {tuning && (
          <ArtifactCard title={t('ml.lab.tuning.title')}>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>{t(`ml.lab.models.${tuning.model}`)} ·</span>
              {Object.entries(tuning.bestParams).map(([name, value]) => (
                <Badge key={name} variant="outline" className="font-mono">
                  {name} = {value}
                </Badge>
              ))}
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span className="text-muted">
                {t('ml.lab.tuning.cvScore')}{' '}
                <span className="font-mono text-ink">{score(tuning.bestCv)}</span>
              </span>
              <span className="text-muted">
                {t('ml.lab.tuning.testScore', {
                  metric: tuning.isClassification ? 'accuracy' : 'RMSE',
                })}{' '}
                <span className="font-mono text-ink">{score(tuning.tunedPrimary)}</span>
              </span>
              {tuningDelta !== null && (
                <span className="text-muted">
                  {t('ml.lab.tuning.delta')}{' '}
                  <span className={`font-mono ${tuningDelta >= 0 ? 'text-ok' : 'text-copper'}`}>
                    {tuningDelta >= 0 ? '+' : ''}
                    {score(tuningDelta)}
                  </span>
                </span>
              )}
            </div>
          </ArtifactCard>
        )}

        {explanation && (
          <ArtifactCard
            title={
              explanation.targetClass
                ? t('ml.lab.insights.explainTitleClass', { class: explanation.targetClass })
                : t('ml.lab.insights.explainTitle')
            }
          >
            <p className="font-mono text-xs text-muted">
              {score(explanation.baseline)} → {score(explanation.prediction)} ·{' '}
              {t(`ml.lab.models.${explanation.model}`)}
            </p>
            <ul className="flex flex-col gap-1.5">
              {explanation.contributions.slice(0, 8).map(({ column, value }) => (
                <li key={column} className="flex items-center gap-2 text-xs">
                  <span className="w-28 truncate font-mono" title={column}>
                    {column}
                  </span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <span
                      className={`block h-full rounded-full ${value >= 0 ? 'bg-accent' : 'bg-copper'}`}
                      style={{ width: `${(Math.abs(value) / maxContribution) * 100}%` }}
                    />
                  </span>
                  <span className="w-16 text-right font-mono tabular-nums">
                    {value >= 0 ? '+' : ''}
                    {value.toFixed(3)}
                  </span>
                </li>
              ))}
            </ul>
          </ArtifactCard>
        )}

        {exploration && (
          <ArtifactCard title={t('ml.lab.explore.title')}>
            <p className="text-xs text-muted">
              {t('ml.lab.explore.summary', {
                k: exploration.k,
                silhouette: exploration.silhouette.toLocaleString(lang, {
                  maximumFractionDigits: 2,
                }),
                tried: exploration.tried.map((entry) => entry.k).join(', '),
                rows: exploration.rowsUsed.toLocaleString(lang),
                p1: (exploration.explained[0] * 100).toLocaleString(lang, {
                  maximumFractionDigits: 0,
                }),
                p2: (exploration.explained[1] * 100).toLocaleString(lang, {
                  maximumFractionDigits: 0,
                }),
              })}
            </p>
            <ul className="flex flex-col gap-2">
              {exploration.clusters.map((cluster) => (
                <li key={cluster.id} className="rounded-xl bg-surface-2 p-3">
                  <p className="flex flex-wrap items-baseline gap-2 text-sm font-medium">
                    {t('ml.lab.explore.clusterName', { id: cluster.id + 1 })}
                    <span className="font-mono text-[0.68rem] font-normal text-muted">
                      {t('ml.lab.explore.clusterSize', {
                        count: cluster.size,
                        share: (cluster.share * 100).toLocaleString(lang, {
                          maximumFractionDigits: 0,
                        }),
                      })}
                    </span>
                  </p>
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {cluster.traits.map((trait, index) => (
                      <TraitLine key={index} trait={trait} />
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </ArtifactCard>
        )}

        {threshold && (
          <ArtifactCard title={t('ml.lab.threshold.title')}>
            <p className="text-xs text-muted">
              {t('ml.lab.threshold.hint', {
                positive: threshold.positiveClass,
                rate: (threshold.positiveRate * 100).toLocaleString(lang, {
                  maximumFractionDigits: 1,
                }),
              })}
            </p>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">AP {threshold.averagePrecision.toFixed(3)}</Badge>
              <Badge variant="outline">Brier {threshold.brier.toFixed(3)}</Badge>
              <Badge variant="outline" className="font-mono">
                {t('ml.lab.threshold.threshold')} = {threshold.chosen.threshold.toFixed(2)}
              </Badge>
              <Badge variant="outline" className="font-mono">
                FP {threshold.chosen.costFp} · FN {threshold.chosen.costFn}
              </Badge>
            </div>
            <table className="w-full max-w-sm text-left text-xs">
              <tbody>
                {(
                  [
                    ['precision', threshold.chosen.precision.toFixed(3)],
                    ['recall', threshold.chosen.recall.toFixed(3)],
                    ['f1', threshold.chosen.f1.toFixed(3)],
                    ['cost', String(threshold.chosen.cost)],
                  ] as const
                ).map(([key, value]) => (
                  <tr key={key} className="border-b border-line last:border-b-0">
                    <td className="py-1 pr-3">{t(`ml.lab.threshold.${key}`)}</td>
                    <td className="py-1 font-mono tabular-nums">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="font-mono text-[0.68rem] text-muted">
              TP {threshold.chosen.tp} · FP {threshold.chosen.fp} · FN {threshold.chosen.fn} · TN{' '}
              {threshold.chosen.tn}
            </p>
          </ArtifactCard>
        )}

        {uncertainty && (
          <ArtifactCard title={t('ml.lab.uncertainty.title')}>
            <p className="text-xs text-muted">
              {t('ml.lab.uncertainty.hint', {
                metric: t(`ml.lab.leaderboard.${uncertainty.metricLabel}`),
                rows: uncertainty.testRows.toLocaleString(lang),
              })}
            </p>
            <table className="w-full max-w-md text-left text-xs">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th className="py-1 pr-3 font-normal">{t('ml.lab.leaderboard.model')}</th>
                  <th className="py-1 pr-3 font-normal">
                    {t(`ml.lab.leaderboard.${uncertainty.metricLabel}`)}
                  </th>
                  <th className="py-1 font-normal">{t('ml.lab.uncertainty.interval')}</th>
                </tr>
              </thead>
              <tbody>
                {uncertainty.intervals.map((interval, index) => (
                  <tr
                    key={interval.model}
                    className={`border-b border-line last:border-b-0 ${
                      index === 0 ? 'font-semibold' : ''
                    }`}
                  >
                    <td className="py-1 pr-3">{t(`ml.lab.models.${interval.model}`)}</td>
                    <td className="py-1 pr-3 font-mono tabular-nums">
                      {interval.point.toFixed(3)}
                    </td>
                    <td className="py-1 font-mono tabular-nums text-muted">
                      [{interval.lo.toFixed(3)} ; {interval.hi.toFixed(3)}]
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {uncertainty.verdict && (
              <p className="text-xs">
                {t(
                  uncertainty.verdict.decisive
                    ? 'ml.lab.uncertainty.verdictReal'
                    : 'ml.lab.uncertainty.verdictNoise',
                  {
                    winner: t(`ml.lab.models.${uncertainty.verdict.winner}`),
                    against: t(`ml.lab.models.${uncertainty.verdict.against}`),
                    metric: t(`ml.lab.leaderboard.${uncertainty.metricLabel}`),
                    delta: `${uncertainty.verdict.delta >= 0 ? '+' : ''}${uncertainty.verdict.delta.toFixed(3)}`,
                    lo: `${uncertainty.verdict.lo >= 0 ? '+' : ''}${uncertainty.verdict.lo.toFixed(3)}`,
                    hi: `${uncertainty.verdict.hi >= 0 ? '+' : ''}${uncertainty.verdict.hi.toFixed(3)}`,
                    share: (uncertainty.verdict.winShare * 100).toLocaleString(lang, {
                      maximumFractionDigits: 1,
                    }),
                  },
                )}
              </p>
            )}
          </ArtifactCard>
        )}

        {segments && (
          <ArtifactCard title={t('ml.lab.segments.title')}>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="font-mono">
                {t(`ml.lab.leaderboard.${segments.metricLabel}`)} {segments.overall.toFixed(3)}
              </Badge>
              <Badge variant="outline">{t(`ml.lab.models.${segments.model}`)}</Badge>
            </div>
            <div className="flex flex-col gap-2">
              {segments.columns.map((column) => (
                <div key={column.column} className="rounded-xl bg-surface-2 p-3">
                  <p className="flex flex-wrap items-center gap-2 text-xs font-medium">
                    <span className="font-mono">{column.column}</span>
                    <Badge variant="outline" className="text-[0.62rem]">
                      {column.inFeatures
                        ? t('ml.lab.segments.inFeatures')
                        : t('ml.lab.segments.outFeatures')}
                    </Badge>
                  </p>
                  <table className="mt-1 w-full text-left text-xs">
                    <tbody>
                      {column.segments.map((segment) => (
                        <tr key={segment.value} className="border-b border-line last:border-b-0">
                          <td className="max-w-40 truncate py-1 pr-3" title={segment.value}>
                            {segment.value}
                          </td>
                          <td className="py-1 pr-3 font-mono tabular-nums text-muted">
                            {segment.rows}
                          </td>
                          <td className="py-1 pr-3 font-mono tabular-nums">
                            {segment.metric.toFixed(3)}
                          </td>
                          <td
                            className={`py-1 font-mono tabular-nums ${
                              (segments.isClassification ? segment.delta < 0 : segment.delta > 0)
                                ? 'text-copper'
                                : 'text-ok'
                            }`}
                          >
                            {segment.delta >= 0 ? '+' : ''}
                            {segment.delta.toFixed(3)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted">{t('ml.lab.segments.note')}</p>
          </ArtifactCard>
        )}

        {batchScore && (
          <ArtifactCard title={`${t('ml.lab.batch.title')} — ${batchScore.fileName}`}>
            <p className="text-xs text-muted">
              {t('ml.lab.batch.verdict', {
                name: batchScore.fileName,
                rows: batchScore.rowCount.toLocaleString(lang),
                model: t(`ml.lab.models.${batchScore.model}`),
              })}
            </p>
            {batchScore.metrics ? (
              <table className="w-full max-w-md text-left text-xs">
                <thead>
                  <tr className="border-b border-line text-muted">
                    <th className="py-1 pr-3 font-normal">{t('ml.lab.batch.colMetric')}</th>
                    <th className="py-1 pr-3 font-normal">{t('ml.lab.batch.colTest')}</th>
                    <th className="py-1 pr-3 font-normal">{t('ml.lab.batch.colBatch')}</th>
                    <th className="py-1 font-normal">{t('ml.lab.batch.colDelta')}</th>
                  </tr>
                </thead>
                <tbody>
                  {METRIC_ROWS.filter(
                    ({ key }) =>
                      batchScore.metrics![key] !== undefined &&
                      batchScore.testMetrics[key] !== undefined,
                  ).map(({ key }) => {
                    const delta = metricDelta(
                      key,
                      batchScore.testMetrics[key]!,
                      batchScore.metrics![key]!,
                    );
                    return (
                      <tr key={key} className="border-b border-line last:border-b-0">
                        <td className="py-1 pr-3">{t(`ml.lab.leaderboard.${key}`)}</td>
                        <td className="py-1 pr-3 font-mono tabular-nums">
                          {batchScore.testMetrics[key]!.toFixed(3)}
                        </td>
                        <td className="py-1 pr-3 font-mono tabular-nums">
                          {batchScore.metrics![key]!.toFixed(3)}
                        </td>
                        <td
                          className={`py-1 font-mono tabular-nums ${delta.better ? 'text-ok' : 'text-copper'}`}
                        >
                          {delta.value >= 0 ? '+' : ''}
                          {delta.value.toFixed(3)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="text-xs text-muted">{t('ml.lab.batch.noTarget')}</p>
            )}
          </ArtifactCard>
        )}

        {forecast && (
          <ArtifactCard title={`${t('ml.lab.forecast.title')} — ${forecast.valueColumn}`}>
            <p className="text-xs text-muted">
              {t('ml.lab.forecast.summary', {
                points: forecast.totalPoints.toLocaleString(lang),
                freq: t(`ml.lab.forecast.freq.${forecast.freq}`),
                holdout: forecast.holdout,
                winner: t(`ml.lab.forecast.methods.${forecast.winner.key}`),
                mae: score(forecast.winner.mae),
                naive: score(forecast.naiveMae),
              })}
            </p>
            <table className="w-full max-w-md text-left text-xs">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th className="py-1 pr-3 font-normal">{t('ml.lab.forecast.methodHeader')}</th>
                  <th className="py-1 pr-3 font-normal">MAE</th>
                  <th className="py-1 font-normal">RMSE</th>
                </tr>
              </thead>
              <tbody>
                {forecast.methods.map((method) => (
                  <tr
                    key={method.key}
                    className={`border-b border-line last:border-b-0 ${
                      method.key === forecast.winner.key ? 'font-semibold' : ''
                    }`}
                  >
                    <td className="py-1 pr-3">{t(`ml.lab.forecast.methods.${method.key}`)}</td>
                    <td className="py-1 pr-3 font-mono tabular-nums">{score(method.mae)}</td>
                    <td className="py-1 font-mono tabular-nums">{score(method.rmse)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ArtifactCard>
        )}
      </div>
    </div>
  );
}

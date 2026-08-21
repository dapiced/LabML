import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Eyebrow } from '@/components/ui/eyebrow';
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
  const { tuning, explanation, exploration, forecast } = artifacts;
  if (!tuning && !explanation && !exploration && !forecast) return null;
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

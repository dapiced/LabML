import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, GitCompareArrows } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Eyebrow } from '@/components/ui/eyebrow';
import { compareRuns } from '@/features/ml/projects/compare';
import { db } from '@/features/ml/projects/db';
import type { RunRecord } from '@/features/ml/projects/types';
import { cn } from '@/lib/utils';

function RunHeader({ label, record }: { label: string; record: RunRecord }) {
  const { i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? 'en';
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-surface-2 p-3">
      <span className="flex items-center gap-2">
        <Badge>{label}</Badge>
        <Link
          to={`/ml/run/${record.id}`}
          className="font-medium hover:text-accent-strong hover:underline"
        >
          {record.name}
        </Link>
      </span>
      <span className="font-mono text-xs text-muted tabular-nums">
        {record.dataset.name} · {record.dataset.rowCount.toLocaleString(lang)} ×{' '}
        {record.dataset.columnCount} · {new Date(record.createdAt).toLocaleString(lang)}
      </span>
    </div>
  );
}

/** v21 — the iterative ML gesture: "did my change help?", side by side. */
export function MlComparePage() {
  const { t } = useTranslation();
  const { a, b } = useParams();
  const pair = useLiveQuery(async () => {
    const [runA, runB] = await Promise.all([db.runs.get(Number(a)), db.runs.get(Number(b))]);
    return { runA: runA ?? null, runB: runB ?? null };
  }, [a, b]);

  if (!pair) return null;
  const { runA, runB } = pair;

  const back = (
    <Link to="/ml" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'mb-6')}>
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      {t('ml.lab.runs.backToLab')}
    </Link>
  );

  if (!runA || !runB) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10">
        {back}
        <p className="text-muted">{t('ml.lab.runs.notFound')}</p>
      </div>
    );
  }

  const diff = compareRuns(runA, runB);
  const metricName = t(`ml.lab.leaderboard.${diff.metricLabel}`);
  const fmt = (v: number) => v.toFixed(3);
  const signed = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(3)}`;
  const featureChanges = diff.features.added.length + diff.features.removed.length > 0;

  const intervals = diff.intervals;
  const min = intervals ? Math.min(intervals.a.lo, intervals.b.lo) : 0;
  const max = intervals ? Math.max(intervals.a.hi, intervals.b.hi) : 1;
  const span = max - min || 1;
  const at = (v: number) => `${(((v - min) / span) * 100).toFixed(2)}%`;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10" data-testid="compare-page">
      {back}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <GitCompareArrows className="h-4 w-4 text-accent" aria-hidden="true" />
          <Eyebrow>{t('ml.lab.compare.title')}</Eyebrow>
          <Badge variant="outline">
            {t(diff.sameDataset ? 'ml.lab.compare.sameDataset' : 'ml.lab.compare.otherDataset')}
          </Badge>
          <Badge variant="outline">
            {t(diff.sameTarget ? 'ml.lab.compare.sameTarget' : 'ml.lab.compare.otherTarget')}
          </Badge>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <RunHeader label="A" record={runA} />
          <RunHeader label="B" record={runB} />
        </div>

        {!diff.comparable && (
          <Card className="border-copper text-sm">{t('ml.lab.compare.notComparable')}</Card>
        )}

        {diff.best && (
          <div
            data-testid="compare-read"
            className={`rounded-2xl p-4 text-sm ${
              diff.best.improved ? 'bg-accent-soft' : 'bg-copper-soft'
            }`}
          >
            {t('ml.lab.compare.read', {
              metric: metricName,
              aModel: t(`ml.lab.models.${diff.best.a.key}`),
              aPrimary: fmt(diff.best.a.primary),
              bModel: t(`ml.lab.models.${diff.best.b.key}`),
              bPrimary: fmt(diff.best.b.primary),
              delta: signed(diff.best.delta),
            })}{' '}
            {t(
              diff.best.delta === 0
                ? 'ml.lab.compare.readEqual'
                : diff.best.improved
                  ? 'ml.lab.compare.readBetter'
                  : 'ml.lab.compare.readWorse',
            )}
          </div>
        )}

        <Card>
          <Eyebrow>{t('ml.lab.compare.featuresTitle')}</Eyebrow>
          {featureChanges ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {diff.features.added.map((name) => (
                <Badge key={`+${name}`} variant="accent" className="font-mono">
                  +{name}
                </Badge>
              ))}
              {diff.features.removed.map((name) => (
                <Badge key={`-${name}`} variant="copper" className="font-mono">
                  −{name}
                </Badge>
              ))}
              <span className="text-xs text-muted">
                {t('ml.lab.compare.kept', { count: diff.features.kept.length })}
              </span>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted">{t('ml.lab.compare.sameFeatures')}</p>
          )}
        </Card>

        {diff.models.length > 0 && (
          <Card>
            <Eyebrow>{t('ml.lab.compare.modelsTitle', { metric: metricName })}</Eyebrow>
            <table className="mt-3 w-full max-w-xl text-left text-sm" data-testid="compare-models">
              <thead>
                <tr className="border-b border-line text-xs text-muted">
                  <th className="py-1.5 pr-3 font-normal">{t('ml.lab.leaderboard.model')}</th>
                  <th className="py-1.5 pr-3 font-normal">A</th>
                  <th className="py-1.5 pr-3 font-normal">B</th>
                  <th className="py-1.5 font-normal">{t('ml.lab.compare.delta')}</th>
                </tr>
              </thead>
              <tbody>
                {diff.models.map(({ key, a: av, b: bv, delta }) => (
                  <tr key={key} className="border-b border-line last:border-b-0">
                    <td className="py-1.5 pr-3">{t(`ml.lab.models.${key}`)}</td>
                    <td className="py-1.5 pr-3 font-mono tabular-nums">
                      {av === null ? '—' : fmt(av)}
                    </td>
                    <td className="py-1.5 pr-3 font-mono tabular-nums">
                      {bv === null ? '—' : fmt(bv)}
                    </td>
                    <td
                      className={`py-1.5 font-mono tabular-nums ${
                        delta === null || delta === 0
                          ? 'text-muted'
                          : (diff.isClassification ? delta > 0 : delta < 0)
                            ? 'text-ok'
                            : 'text-copper'
                      }`}
                    >
                      {delta === null ? '—' : signed(delta)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        {intervals && (
          <Card data-testid="compare-intervals">
            <Eyebrow>{t('ml.lab.compare.intervalsTitle')}</Eyebrow>
            <ul className="mt-3 flex max-w-xl flex-col gap-1.5">
              {(
                [
                  ['A', intervals.a],
                  ['B', intervals.b],
                ] as const
              ).map(([label, interval]) => (
                <li key={label} className="flex items-center gap-2 text-xs">
                  <span className="w-24 truncate">
                    {label} · {t(`ml.lab.models.${interval.model}`)}
                  </span>
                  <span className="relative h-3 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <span
                      className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-accent opacity-40"
                      style={{
                        left: at(interval.lo),
                        width: `calc(${at(interval.hi)} - ${at(interval.lo)})`,
                      }}
                    />
                    <span
                      className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent"
                      style={{ left: at(interval.point) }}
                    />
                  </span>
                  <span className="w-40 text-right font-mono tabular-nums">
                    {fmt(interval.point)}{' '}
                    <span className="text-muted">
                      [{fmt(interval.lo)} ; {fmt(interval.hi)}]
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm">
              {t(
                intervals.overlap
                  ? 'ml.lab.compare.intervalsOverlap'
                  : 'ml.lab.compare.intervalsDisjoint',
              )}
            </p>
            <p className="mt-2 text-xs text-muted">{t('ml.lab.compare.intervalsNote')}</p>
          </Card>
        )}
      </div>
    </div>
  );
}

export default MlComparePage;

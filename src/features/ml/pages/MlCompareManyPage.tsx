import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Eyebrow } from '@/components/ui/eyebrow';
import { db } from '@/features/ml/projects/db';
import { compareMany } from '@/features/ml/projects/compare-many';
import { cn } from '@/lib/utils';
import { ScrollRegion } from '@/components/ui/scroll-region';

/**
 * V37: three or more runs, side by side, all read against the OLDEST — which
 * is where the session started, so the deltas say « what my changes did »
 * rather than « what the newest run happens to be ».
 */
export default function MlCompareManyPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? 'en';
  const { ids } = useParams<{ ids: string }>();
  const wanted = (ids ?? '')
    .split('-')
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);

  const runs = useLiveQuery(() => db.runs.bulkGet(wanted), [ids]);
  const found = (runs ?? []).filter((run) => run !== undefined);
  const comparison = found.length > 0 ? compareMany(found) : null;

  const fmt = (value: number | null) =>
    value === null
      ? '—'
      : value.toLocaleString(lang, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const signed = (value: number | null) =>
    value === null ? '' : `${value > 0 ? '+' : ''}${value.toFixed(3)}`;

  return (
    <div
      className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8"
      data-testid="compare-many-page"
    >
      <Link
        to="/ml"
        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'self-start')}
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t('ml.lab.runs.backToLab')}
      </Link>

      {comparison === null ? (
        <Card className="p-4 text-sm">{t('ml.lab.compare.manyMissing')}</Card>
      ) : (
        <>
          <div>
            <Eyebrow>{t('ml.lab.compare.manyTitle')}</Eyebrow>
            <p className="mt-1 max-w-3xl text-xs text-muted">
              {t('ml.lab.compare.manyHint', {
                reference:
                  comparison.columns.find((c) => c.id === comparison.referenceId)?.name ?? '',
              })}
            </p>
          </div>

          {!comparison.comparable && (
            <Card className="border-copper bg-copper-soft p-3 text-sm text-copper">
              {t('ml.lab.compare.manyIncomparable')}
            </Card>
          )}

          <ScrollRegion className="rounded-2xl border border-line bg-surface">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-surface-2 font-mono text-[0.68rem] tracking-wider uppercase">
                  <th className="px-3 py-2 font-medium">{t('ml.lab.leaderboard.model')}</th>
                  {comparison.columns.map((column) => (
                    <th key={column.id} className="px-3 py-2 font-medium">
                      {column.name}
                      {column.id === comparison.referenceId && (
                        <span className="block text-[0.62rem] normal-case">
                          {t('ml.lab.compare.reference')}
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="tabular-nums">
                <tr className="border-t border-line font-medium">
                  <td className="px-3 py-2">{t('ml.lab.compare.champion')}</td>
                  {comparison.columns.map((column) => (
                    <td
                      key={column.id}
                      className={cn(
                        'px-3 py-2',
                        column.id === comparison.leaderId && 'bg-accent-soft/50',
                      )}
                    >
                      {column.best === null ? (
                        '—'
                      ) : (
                        <>
                          <span className="block">
                            {t(`ml.lab.models.${column.best.key}`)} {fmt(column.best.value)}
                          </span>
                          {column.delta !== null && (
                            <span
                              className={cn(
                                'block text-[0.68rem]',
                                column.delta > 0 ? 'text-accent-strong' : 'text-muted',
                              )}
                            >
                              {signed(column.delta)}
                            </span>
                          )}
                        </>
                      )}
                    </td>
                  ))}
                </tr>
                {comparison.models.map((model) => (
                  <tr key={model.key} className="border-t border-line">
                    <td className="px-3 py-2">{t(`ml.lab.models.${model.key}`)}</td>
                    {model.values.map((value, index) => (
                      <td
                        key={comparison.columns[index].id}
                        className={cn('px-3 py-2', value === null && 'text-muted')}
                      >
                        {fmt(value)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>

          <Card className="flex flex-col gap-2 p-4 text-sm">
            <Eyebrow>{t('ml.lab.compare.featuresTitle')}</Eyebrow>
            <p className="text-xs text-muted">
              {t('ml.lab.compare.manyShared', {
                count: comparison.sharedFeatures.length,
                columns: comparison.sharedFeatures.join(', ') || '—',
              })}
            </p>
            {comparison.columns
              .filter((column) => column.added.length > 0 || column.removed.length > 0)
              .map((column) => (
                <p key={column.id} className="text-xs">
                  <span className="font-medium">{column.name}</span>{' '}
                  {column.added.length > 0 && (
                    <span className="text-accent-strong">+{column.added.join(', ')} </span>
                  )}
                  {column.removed.length > 0 && (
                    <span className="text-copper">−{column.removed.join(', ')}</span>
                  )}
                </p>
              ))}
          </Card>
        </>
      )}
    </div>
  );
}

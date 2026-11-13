import { Activity } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Eyebrow } from '@/components/ui/eyebrow';
import type { ProductionCheck } from '@/features/ml/train/production-check';

/** The sentence under the verdict: which of the three signals decided it. */
function reasonKey(check: ProductionCheck): string {
  const measured = check.performance.status === 'measured';
  if (check.verdict === 'retrain') return 'retrain';
  if (check.verdict === 'watch') return measured ? 'watchHolds' : 'watchNoLabels';
  if (!check.hasReference) return measured ? 'stableNoReference' : 'nothing';
  return measured ? 'stableLabels' : 'stableNoLabels';
}

/**
 * V61: one batch read against what its model was exported with. One verdict,
 * then the three signals behind it, each either read or named as unreadable.
 */
export function ProductionCheckView({ check }: { check: ProductionCheck }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? 'en';
  const num = (value: number, digits = 2) =>
    value.toLocaleString(lang, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const signed = (value: number, digits: number) => (value >= 0 ? '+' : '') + num(value, digits);
  const p = check.performance;
  const drifted = check.columns.filter((column) => column.drifted);
  const labelledRows = p.status === 'no-labels' ? 0 : p.rows;

  return (
    <section
      data-testid="production-check"
      data-verdict={check.verdict}
      className="flex flex-col gap-3 rounded-2xl border border-line bg-surface-2 p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Activity className="h-4 w-4 text-accent" aria-hidden="true" />
        <Eyebrow>{t('ml.lab.production.title')}</Eyebrow>
        <Badge
          variant={check.verdict === 'stable' ? 'outline' : 'copper'}
          data-testid="production-verdict"
        >
          {t(`ml.lab.production.verdict.${check.verdict}`)}
        </Badge>
      </div>
      <p className="max-w-3xl text-sm" data-testid="production-why">
        {t(`ml.lab.production.why.${reasonKey(check)}`, {
          rows: labelledRows.toLocaleString(lang),
        })}
      </p>

      {!check.hasReference && (
        <p className="max-w-3xl text-xs text-muted" data-testid="production-no-reference">
          {t('ml.lab.production.noReference')}
        </p>
      )}

      {check.hasReference && (
        <div className="flex flex-col gap-1 text-xs" data-testid="production-columns">
          <span className="font-semibold">{t('ml.lab.production.columnsTitle')}</span>
          {drifted.length === 0 ? (
            <p className="text-muted">
              {t('ml.lab.production.columnsNone', { total: check.columns.length })}
            </p>
          ) : (
            <>
              <p>
                {t('ml.lab.production.columnsSome', {
                  count: drifted.length,
                  total: check.columns.length,
                })}
              </p>
              <ul className="flex flex-col gap-0.5 font-mono text-[0.7rem]">
                {drifted.map((column) => (
                  <li key={column.column}>
                    {t('ml.lab.production.columnLine', {
                      column: column.column,
                      psi: num(column.psi),
                      ceiling: num(column.ceiling),
                    })}
                    {column.refMean !== undefined &&
                      column.newMean !== undefined &&
                      t('ml.lab.production.columnMeans', {
                        from: num(column.refMean),
                        to: num(column.newMean),
                      })}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {check.predictions && (
        <div className="flex flex-col gap-1 text-xs" data-testid="production-answers">
          <span className="font-semibold">{t('ml.lab.production.answersTitle')}</span>
          <p className={check.predictions.drifted ? '' : 'text-muted'}>
            {t(
              check.predictions.drifted
                ? 'ml.lab.production.answersDrift'
                : 'ml.lab.production.answersNoise',
              { psi: num(check.predictions.psi), ceiling: num(check.predictions.ceiling) },
            )}
          </p>
        </div>
      )}

      <div className="flex flex-col gap-1 text-xs" data-testid="production-performance">
        <span className="font-semibold">{t('ml.lab.production.performanceTitle')}</span>
        {p.status === 'no-labels' && (
          <p className="text-muted">{t('ml.lab.production.perf.noLabels')}</p>
        )}
        {p.status === 'too-few' && (
          <p className="text-muted">
            {t('ml.lab.production.perf.tooFew', { rows: p.rows, min: p.min })}
          </p>
        )}
        {p.status === 'no-spread' && (
          <p className="text-muted">{t('ml.lab.production.perf.noSpread', { rows: p.rows })}</p>
        )}
        {p.status === 'measured' && (
          <p>
            {p.metric === 'accuracy'
              ? t('ml.lab.production.perf.accuracy', {
                  reference: num(p.reference * 100, 1),
                  batch: num(p.batch * 100, 1),
                  delta: signed(p.delta * 100, 1),
                  lo: signed(p.lo * 100, 1),
                  hi: signed(p.hi * 100, 1),
                })
              : t('ml.lab.production.perf.rmse', {
                  reference: num(p.reference),
                  batch: num(p.batch),
                  delta: signed(p.delta, 2),
                  lo: signed(p.lo, 2),
                  hi: signed(p.hi, 2),
                })}{' '}
            {t(`ml.lab.production.perf.${p.reading}`)}
          </p>
        )}
      </div>

      {check.hasReference && (
        <p className="max-w-3xl text-xs text-muted">{t('ml.lab.production.method')}</p>
      )}
    </section>
  );
}

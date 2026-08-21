import { CopyX, EyeOff, Ruler, SearchX, SpellCheck2, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { useDataStore } from '@/features/data/data-store';
import type { QualityReport } from '@/features/data/quality/types';
import { cn } from '@/lib/utils';

function band(score: number): 'good' | 'fair' | 'poor' {
  if (score >= 90) return 'good';
  if (score >= 70) return 'fair';
  return 'poor';
}

function ScoreTile({ label, report }: { label: string; report: QualityReport }) {
  const { t } = useTranslation();
  const scoreBand = band(report.score);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium tracking-wide text-muted uppercase">{label}</span>
      <span
        className={cn(
          'font-display text-4xl font-bold',
          scoreBand === 'good' ? 'text-ok' : 'text-copper',
        )}
        data-testid="quality-score"
      >
        {report.score}
        <span className="text-lg text-muted">/100</span>
      </span>
      <span className="text-xs text-muted">
        {t(`data.score.bands.${scoreBand}`)} · {report.rowCount.toLocaleString()} ×{' '}
        {report.columnCount}
      </span>
    </div>
  );
}

const NUMBER = new Intl.NumberFormat();

/** The "before" quality report, one card per issue family. */
export function QualitySummary() {
  const { t, i18n } = useTranslation();
  const report = useDataStore((s) => s.report);
  const cleanedReport = useDataStore((s) => s.cleanedReport);
  if (!report) return null;

  const percent = (ratio: number) =>
    (ratio * 100).toLocaleString(i18n.resolvedLanguage, { maximumFractionDigits: 1 });
  const isClean =
    report.missingCells === 0 &&
    report.duplicateRows === 0 &&
    report.messyCells === 0 &&
    report.outlierCells === 0 &&
    report.structural.length === 0;

  return (
    <section className="flex flex-col gap-4 pb-12">
      <Card className="flex flex-wrap items-center gap-8">
        <ScoreTile label={t('data.score.before')} report={report} />
        <span aria-hidden="true" className="text-2xl text-muted">
          →
        </span>
        {cleanedReport && <ScoreTile label={t('data.score.after')} report={cleanedReport} />}
      </Card>

      <h2 className="font-display text-2xl font-semibold">{t('data.issues.title')}</h2>
      {isClean ? (
        <Card className="flex items-center gap-3 text-sm">
          <Sparkles className="h-5 w-5 shrink-0 text-ok" aria-hidden="true" />
          {t('data.issues.none')}
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {report.missingCells > 0 && (
            <Card className="flex flex-col gap-2" data-testid="issue-missing">
              <SearchX className="h-5 w-5 text-copper" aria-hidden="true" />
              <h3 className="font-display text-lg font-semibold">
                {t('data.issues.missing.title', { count: report.missingCells })}
              </h3>
              <p className="text-sm text-muted">{t('data.issues.missing.body')}</p>
              <ul className="flex flex-wrap gap-2 text-xs">
                {report.missingColumns.slice(0, 4).map(({ column, count, ratio }) => (
                  <li key={column} className="rounded-full bg-surface-2 px-2.5 py-1 font-mono">
                    {column} · {NUMBER.format(count)} ({percent(ratio)} %)
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {report.duplicateRows > 0 && (
            <Card className="flex flex-col gap-2" data-testid="issue-duplicates">
              <CopyX className="h-5 w-5 text-copper" aria-hidden="true" />
              <h3 className="font-display text-lg font-semibold">
                {t('data.issues.duplicates.title', { count: report.duplicateRows })}
              </h3>
              <p className="text-sm text-muted">{t('data.issues.duplicates.body')}</p>
            </Card>
          )}

          {report.messyCells > 0 && (
            <Card className="flex flex-col gap-2" data-testid="issue-messy">
              <SpellCheck2 className="h-5 w-5 text-copper" aria-hidden="true" />
              <h3 className="font-display text-lg font-semibold">
                {t('data.issues.messy.title', { count: report.messyCells })}
              </h3>
              <p className="text-sm text-muted">{t('data.issues.messy.body')}</p>
              <ul className="flex flex-col gap-1 text-xs">
                {report.messyColumns.slice(0, 3).map(({ column, groups }) => (
                  <li key={column} className="font-mono">
                    <span className="text-muted">{column} :</span>{' '}
                    {groups[0].variants.map((variant, i) => (
                      <span key={variant}>
                        {i > 0 && ' · '}
                        <span
                          className={
                            variant === groups[0].canonical ? 'font-semibold' : 'line-through'
                          }
                        >
                          «{variant}»
                        </span>
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {report.outlierCells > 0 && (
            <Card className="flex flex-col gap-2" data-testid="issue-outliers">
              <Ruler className="h-5 w-5 text-copper" aria-hidden="true" />
              <h3 className="font-display text-lg font-semibold">
                {t('data.issues.outliers.title', { count: report.outlierCells })}
              </h3>
              <p className="text-sm text-muted">{t('data.issues.outliers.body')}</p>
              <ul className="flex flex-col gap-1 text-xs font-mono">
                {report.outlierColumns.slice(0, 3).map(({ column, count, low, high }) => (
                  <li key={column}>
                    {column} · {NUMBER.format(count)} ∉ [{Number(low.toFixed(2))} ;{' '}
                    {Number(high.toFixed(2))}]
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {report.structural.length > 0 && (
            <Card className="flex flex-col gap-2" data-testid="issue-structural">
              <EyeOff className="h-5 w-5 text-copper" aria-hidden="true" />
              <h3 className="font-display text-lg font-semibold">
                {t('data.issues.structural.title', { count: report.structural.length })}
              </h3>
              <p className="text-sm text-muted">{t('data.issues.structural.body')}</p>
              <ul className="flex flex-wrap gap-2 text-xs">
                {report.structural.map(({ column, kind }) => (
                  <li
                    key={column}
                    className="flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1"
                  >
                    <span className="font-mono">{column}</span>
                    <Badge variant="outline">{t(`data.issues.structural.${kind}`)}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
    </section>
  );
}

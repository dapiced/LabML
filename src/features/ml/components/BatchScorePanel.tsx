import { FileScan, Loader2 } from 'lucide-react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/eyebrow';
import { useLabStore } from '@/features/ml/lab-store';
import { METRIC_ROWS, metricDelta } from '@/features/ml/train/score-view';

function downloadCsv(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** The production gesture: score a NEW file with the inspected model. */
export function BatchScorePanel() {
  const { t, i18n } = useTranslation();
  const trainStatus = useLabStore((s) => s.trainStatus);
  const insights = useLabStore((s) => s.insights);
  const meta = useLabStore((s) => s.meta);
  const batchStatus = useLabStore((s) => s.batchStatus);
  const result = useLabStore((s) => s.batchResult);
  const batchError = useLabStore((s) => s.batchError);
  const scoreBatch = useLabStore((s) => s.scoreBatch);
  const scoreBatchDemo = useLabStore((s) => s.scoreBatchDemo);
  const inputRef = useRef<HTMLInputElement>(null);
  if (trainStatus !== 'done' || !insights) return null;

  const lang = i18n.resolvedLanguage ?? 'en';
  const fmt = (v: number | undefined) => (v === undefined || Number.isNaN(v) ? '—' : v.toFixed(3));
  const isDemoDataset = meta?.name === 'iris.csv';
  const missing = batchError?.startsWith('missing-columns:')
    ? batchError.slice('missing-columns:'.length)
    : null;

  return (
    <section
      data-testid="batch-score"
      className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4"
    >
      <div>
        <div className="flex items-center gap-2">
          <FileScan className="h-4 w-4 text-accent" aria-hidden="true" />
          <Eyebrow>{t('ml.lab.batch.title')}</Eyebrow>
        </div>
        <p className="mt-1 max-w-3xl text-xs text-muted">
          {t('ml.lab.batch.hint', { model: t(`ml.lab.models.${insights.model}`) })}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          data-testid="batch-browse"
          className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-sm transition-colors hover:border-accent hover:bg-accent-soft"
        >
          {t('ml.lab.batch.browse')}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.tsv,.txt,.xlsx,.xls,text/csv"
          className="sr-only"
          aria-label={t('ml.lab.batch.browse')}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) scoreBatch(file);
            e.target.value = '';
          }}
        />
        {isDemoDataset && (
          <button
            type="button"
            onClick={() => scoreBatchDemo('iris-field.csv')}
            data-testid="batch-demo"
            className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 transition-colors hover:border-accent hover:bg-accent-soft"
          >
            <span className="font-mono text-xs">iris-field.csv</span>
            <Badge variant="outline">{t('ml.lab.batch.demoTag')}</Badge>
          </button>
        )}
        {batchStatus === 'scoring' && (
          <span className="flex items-center gap-2 text-sm text-muted" aria-live="polite">
            <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden="true" />
            {t('ml.lab.batch.scoring')}
          </span>
        )}
      </div>

      {batchStatus === 'error' && (
        <p className="text-sm text-copper" data-testid="batch-error">
          {missing
            ? t('ml.lab.batch.missingColumns', { list: missing })
            : t('ml.lab.batch.error', { detail: batchError ?? '' })}
        </p>
      )}

      {batchStatus === 'done' && result && (
        <div className="flex flex-col gap-4" data-testid="batch-result">
          <p className="text-sm">
            {t('ml.lab.batch.verdict', {
              name: result.fileName,
              rows: result.rowCount.toLocaleString(lang),
              model: t(`ml.lab.models.${result.model}`),
            })}
          </p>

          {result.metrics ? (
            <div className="overflow-x-auto">
              <table className="w-full max-w-xl text-left text-xs">
                <thead>
                  <tr className="border-b border-line text-muted">
                    <th className="py-1.5 pr-3 font-normal">{t('ml.lab.batch.colMetric')}</th>
                    <th className="py-1.5 pr-3 font-normal">{t('ml.lab.batch.colTest')}</th>
                    <th className="py-1.5 pr-3 font-normal">{t('ml.lab.batch.colBatch')}</th>
                    <th className="py-1.5 font-normal">{t('ml.lab.batch.colDelta')}</th>
                  </tr>
                </thead>
                <tbody>
                  {METRIC_ROWS.filter(
                    ({ key }) =>
                      result.metrics![key] !== undefined && result.testMetrics[key] !== undefined,
                  ).map(({ key }) => {
                    const delta = metricDelta(key, result.testMetrics[key]!, result.metrics![key]!);
                    return (
                      <tr key={key} className="border-b border-line last:border-b-0">
                        <td className="py-1.5 pr-3">{t(`ml.lab.leaderboard.${key}`)}</td>
                        <td className="py-1.5 pr-3 font-mono tabular-nums">
                          {fmt(result.testMetrics[key])}
                        </td>
                        <td className="py-1.5 pr-3 font-mono tabular-nums">
                          {fmt(result.metrics![key])}
                        </td>
                        <td
                          className={`py-1.5 font-mono tabular-nums ${
                            delta.better ? 'text-ok' : 'text-copper'
                          }`}
                        >
                          {delta.value >= 0 ? '+' : ''}
                          {delta.value.toFixed(3)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {result.unknownLabels > 0 && (
                <p className="mt-2 text-xs text-muted">
                  {t('ml.lab.batch.unknownLabels', { count: result.unknownLabels })}
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted">{t('ml.lab.batch.noTarget')}</p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadCsv(result.fileName.replace(/\.[a-z]+$/i, '') + '-scored.csv', result.csv)
              }
            >
              {t('ml.lab.batch.downloadCsv')}
            </Button>
            <span className="font-mono text-[0.65rem] text-muted">
              {result.preview
                .slice(0, 4)
                .map((p) => p.predicted + (p.actual ? ` (${p.actual})` : ''))
                .join(' · ')}
              {result.rowCount > 4 ? ' · …' : ''}
            </span>
          </div>

          <p className="text-xs text-muted">{t('ml.lab.batch.note')}</p>
        </div>
      )}
    </section>
  );
}

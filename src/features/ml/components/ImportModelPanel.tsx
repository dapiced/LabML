import { FileUp, PackageOpen, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/eyebrow';
import { METRIC_ROWS, metricDelta } from '@/features/ml/train/score-view';
import { useLabStore } from '@/features/ml/lab-store';
import { cn } from '@/lib/utils';

function downloadCsv(content: string, name: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Maps a named worker refusal to its translation key (suffixes stripped). */
function errorKey(message: string): { key: string; detail?: string } {
  if (message.startsWith('missing-columns:')) {
    return { key: 'missingColumns', detail: message.slice('missing-columns:'.length) };
  }
  const code = message.split(':')[0];
  const known = [
    'invalid-json',
    'not-labml',
    'unsupported-version',
    'bad-manifest',
    'unsupported-kind',
    'no-model',
    'empty',
  ];
  return known.includes(code) ? { key: code } : { key: 'generic' };
}

/**
 * v22 — the exported model comes back: drop the JSON, read its manifest,
 * then score any CSV without retraining. Refusals are named, never silent.
 */
export function ImportModelPanel() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? 'en';
  const manifest = useLabStore((s) => s.importedManifest);
  const status = useLabStore((s) => s.importedStatus);
  const result = useLabStore((s) => s.importedResult);
  const error = useLabStore((s) => s.importedError);
  const importModelFile = useLabStore((s) => s.importModelFile);
  const importedScoreFile = useLabStore((s) => s.importedScoreFile);
  const clearImported = useLabStore((s) => s.clearImported);

  const errorText = error
    ? (() => {
        const { key, detail } = errorKey(error);
        return t(`ml.lab.imported.errors.${key}`, { detail });
      })()
    : null;

  return (
    <div
      data-testid="import-model-panel"
      className="mt-4 flex flex-col gap-3 rounded-2xl border border-dashed border-line bg-surface p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <PackageOpen className="h-4 w-4 text-accent" aria-hidden="true" />
        <Eyebrow>{t('ml.lab.imported.title')}</Eyebrow>
        {manifest && (
          <button
            type="button"
            onClick={clearImported}
            aria-label={t('ml.lab.imported.clear')}
            title={t('ml.lab.imported.clear')}
            className="ml-auto rounded p-1.5 text-muted hover:bg-surface-2 hover:text-ink"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      {!manifest && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="max-w-xl text-xs text-muted">{t('ml.lab.imported.hint')}</p>
          <label
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'cursor-pointer')}
          >
            <FileUp className="h-3.5 w-3.5" aria-hidden="true" />
            {status === 'loading' ? t('ml.lab.imported.loading') : t('ml.lab.imported.browse')}
            <input
              type="file"
              accept="application/json,.json"
              className="sr-only"
              data-testid="import-model-input"
              disabled={status !== 'idle'}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) importModelFile(file);
                event.target.value = '';
              }}
            />
          </label>
        </div>
      )}

      {manifest && (
        <div data-testid="imported-manifest" className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="accent">{t(`ml.lab.models.${manifest.model}`)}</Badge>
            <Badge variant="outline">
              {t('ml.lab.imported.targetBadge', { target: manifest.target })}
            </Badge>
            {manifest.testMetrics.accuracy !== undefined && (
              <Badge variant="outline" className="font-mono">
                {t('ml.lab.leaderboard.accuracy')} {manifest.testMetrics.accuracy.toFixed(3)}
              </Badge>
            )}
            {manifest.testMetrics.rmse !== undefined && (
              <Badge variant="outline" className="font-mono">
                RMSE {manifest.testMetrics.rmse.toFixed(3)}
              </Badge>
            )}
          </div>
          <p className="font-mono text-xs text-muted">
            {t('ml.lab.imported.summary', {
              features: manifest.featureColumns.join(', '),
              source: manifest.sourceDataset?.name ?? '—',
              date: manifest.createdAt ? new Date(manifest.createdAt).toLocaleString(lang) : '—',
            })}
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <label className={cn(buttonVariants({ size: 'sm' }), 'cursor-pointer')}>
              <FileUp className="h-3.5 w-3.5" aria-hidden="true" />
              {status === 'scoring' ? t('ml.lab.imported.scoring') : t('ml.lab.imported.scoreCta')}
              <input
                type="file"
                accept=".csv,.tsv,.txt,.xlsx,.xls,text/csv"
                className="sr-only"
                data-testid="imported-score-input"
                disabled={status !== 'idle'}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) importedScoreFile(file);
                  event.target.value = '';
                }}
              />
            </label>
            <p className="text-xs text-muted">{t('ml.lab.imported.scoreHint')}</p>
          </div>
        </div>
      )}

      {errorText && (
        <p className="text-xs text-copper" data-testid="imported-error">
          {errorText}
        </p>
      )}

      {result && (
        <div className="flex flex-col gap-2" data-testid="imported-result">
          <p className="text-sm">
            {t('ml.lab.imported.verdict', {
              name: result.fileName,
              rows: result.rowCount.toLocaleString(lang),
              model: t(`ml.lab.models.${result.model}`),
            })}
          </p>
          {result.metrics ? (
            <table className="w-full max-w-md text-left text-xs" data-testid="imported-metrics">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th className="py-1 pr-3 font-normal">{t('ml.lab.batch.colMetric')}</th>
                  <th className="py-1 pr-3 font-normal">{t('ml.lab.imported.colReference')}</th>
                  <th className="py-1 pr-3 font-normal">{t('ml.lab.batch.colBatch')}</th>
                  <th className="py-1 font-normal">{t('ml.lab.batch.colDelta')}</th>
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
                      <td className="py-1 pr-3">{t(`ml.lab.leaderboard.${key}`)}</td>
                      <td className="py-1 pr-3 font-mono tabular-nums">
                        {result.testMetrics[key]!.toFixed(3)}
                      </td>
                      <td className="py-1 pr-3 font-mono tabular-nums">
                        {result.metrics![key]!.toFixed(3)}
                      </td>
                      <td
                        className={`py-1 font-mono tabular-nums ${
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
          ) : (
            <p className="text-xs text-muted">{t('ml.lab.batch.noTarget')}</p>
          )}
          {result.unknownLabels > 0 && (
            <p className="text-xs text-muted">
              {t('ml.lab.batch.unknownLabels', { count: result.unknownLabels })}
            </p>
          )}
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => downloadCsv(result.csv, `labml-imported-${result.fileName}`)}
            >
              {t('ml.lab.batch.downloadCsv')}
            </Button>
          </div>
          <p className="text-xs text-muted">{t('ml.lab.imported.note')}</p>
        </div>
      )}
    </div>
  );
}

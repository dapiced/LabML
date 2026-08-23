import { Loader2 } from 'lucide-react';
import { Suspense, lazy } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Eyebrow } from '@/components/ui/eyebrow';
import { MAX_CELLS } from '@/features/ml/data/limits';
import { DropZone } from '@/features/ml/components/DropZone';
import { ImportModelPanel } from '@/features/ml/components/ImportModelPanel';
import { useLabStore } from '@/features/ml/lab-store';

// The whole post-load lab arrives only once a dataset is actually loaded.
const DatasetView = lazy(() => import('@/features/ml/components/DatasetView'));

function ParsingPanel() {
  const { t } = useTranslation();
  const rowsParsed = useLabStore((s) => s.rowsParsed);
  const reset = useLabStore((s) => s.reset);
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-line bg-surface p-10 text-center">
      <Loader2 className="h-8 w-8 animate-spin text-accent" aria-hidden="true" />
      <p className="font-display text-lg font-semibold">{t('ml.lab.parsing')}</p>
      {rowsParsed > 0 && (
        <p className="font-mono text-sm text-muted tabular-nums">
          {t('ml.lab.rowsRead', { count: rowsParsed })}
        </p>
      )}
      <Button variant="outline" size="sm" onClick={reset}>
        {t('ml.lab.cancel')}
      </Button>
    </div>
  );
}

function ErrorPanel() {
  const { t, i18n } = useTranslation();
  const reset = useLabStore((s) => s.reset);
  const error = useLabStore((s) => s.error);
  // V25: the memory guard refuses by name, with the numbers ('too-large:rows:cols').
  const tooLarge = error?.startsWith('too-large:') ? error.split(':') : null;
  // V33: found by the refusal inventory. A kept dataset that IndexedDB no
  // longer holds used to fall through to « the file looks empty or not
  // tabular » — sending the reader to hunt a format problem that does not
  // exist. Nothing was read: the browser dropped it, or it was forgotten.
  const datasetMissing = error === 'dataset-missing';
  const lang = i18n.resolvedLanguage ?? 'en';
  return (
    <div
      data-testid="parse-error"
      className="flex flex-col items-center gap-3 rounded-2xl border border-line bg-surface p-10 text-center"
    >
      <p className="font-display text-lg font-semibold">
        {tooLarge
          ? t('ml.lab.errorTooLargeTitle')
          : datasetMissing
            ? t('ml.lab.errorDatasetMissingTitle')
            : t('ml.lab.errorTitle')}
      </p>
      <p className="max-w-md text-sm text-muted">
        {tooLarge
          ? t('ml.lab.errorTooLarge', {
              max: MAX_CELLS.toLocaleString(lang),
              rows: Number(tooLarge[1]).toLocaleString(lang),
              cols: tooLarge[2],
            })
          : datasetMissing
            ? t('ml.lab.errorDatasetMissing')
            : t('ml.lab.errorBody')}
      </p>
      <Button variant="outline" size="sm" onClick={reset}>
        {t('ml.lab.retry')}
      </Button>
    </div>
  );
}

export function LabSection() {
  const { t } = useTranslation();
  const status = useLabStore((s) => s.status);

  return (
    <section aria-label={t('ml.lab.title')} className="flex flex-col gap-4 pb-12">
      <Card className="p-6 sm:p-8">
        <div className="mb-5 flex items-center justify-between gap-3">
          <Eyebrow>ml_lab · {t('ml.lab.title')}</Eyebrow>
          <span className="font-mono text-[0.65rem] tracking-wider text-muted uppercase">
            {t('ml.lab.noRequests')}
          </span>
        </div>
        {status === 'idle' && (
          <>
            <DropZone />
            <ImportModelPanel />
          </>
        )}
        {status === 'parsing' && <ParsingPanel />}
        {status === 'error' && <ErrorPanel />}
        {status === 'ready' && (
          <Suspense
            fallback={
              <Loader2 className="mx-auto h-6 w-6 animate-spin text-accent" aria-hidden="true" />
            }
          >
            <DatasetView />
          </Suspense>
        )}
      </Card>
    </section>
  );
}

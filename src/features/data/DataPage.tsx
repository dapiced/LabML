import { Loader2, RotateCcw, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Eyebrow } from '@/components/ui/eyebrow';
import { DataDropZone } from '@/features/data/components/DataDropZone';
import { DataExportBar } from '@/features/data/components/DataExportBar';
import { DataPreview } from '@/features/data/components/DataPreview';
import { DriftPanel } from '@/features/data/components/DriftPanel';
import { QualitySummary } from '@/features/data/components/QualitySummary';
import { RecipePanel } from '@/features/data/components/RecipePanel';
import { useDataStore } from '@/features/data/data-store';

export function DataPage() {
  const { t } = useTranslation();
  const status = useDataStore((s) => s.status);
  const rowsParsed = useDataStore((s) => s.rowsParsed);
  const meta = useDataStore((s) => s.meta);
  const error = useDataStore((s) => s.error);
  const reset = useDataStore((s) => s.reset);

  return (
    <div className="mx-auto max-w-6xl px-4">
      <section className="py-12 sm:py-16">
        <Eyebrow>{t('data.eyebrow')}</Eyebrow>
        <h1 className="mt-3 max-w-3xl font-display text-3xl font-bold text-balance sm:text-5xl">
          {t('data.title')}
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-muted">{t('data.lede')}</p>
      </section>

      {status === 'idle' && (
        <section className="pb-12">
          <DataDropZone />
        </section>
      )}

      {status === 'parsing' && (
        <section className="pb-12" aria-live="polite">
          <Card className="flex items-center gap-3 text-sm text-muted">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" aria-hidden="true" />
            {t('data.parsing', { rows: rowsParsed.toLocaleString() })}
          </Card>
        </section>
      )}

      {status === 'error' && (
        <section className="flex flex-col items-start gap-4 pb-12">
          <Card className="border-copper text-sm">{t('data.error', { detail: error ?? '' })}</Card>
          <Button variant="outline" onClick={reset}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            {t('data.restart')}
          </Button>
        </section>
      )}

      {status === 'ready' && meta && (
        <>
          <section className="flex flex-wrap items-center justify-between gap-3 pb-6">
            <p className="text-sm text-muted">
              <span className="font-mono">{meta.name}</span> ·{' '}
              {t('data.loaded', {
                rows: meta.rowCount.toLocaleString(),
                columns: meta.columnCount,
              })}
            </p>
            <Button variant="ghost" size="sm" onClick={reset}>
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              {t('data.restart')}
            </Button>
          </section>

          <QualitySummary />
          <RecipePanel />
          <DataExportBar />
          <DriftPanel />
          <DataPreview />
        </>
      )}

      <section className="pb-20">
        <Card className="flex flex-col gap-2 bg-surface-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-accent" aria-hidden="true" />
            <Eyebrow>{t('data.privacy.title')}</Eyebrow>
          </div>
          <p className="max-w-3xl text-sm leading-relaxed text-muted">{t('data.privacy.body')}</p>
        </Card>
      </section>
    </div>
  );
}

export default DataPage;

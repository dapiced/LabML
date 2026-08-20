import { Loader2, RotateCcw, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Eyebrow } from '@/components/ui/eyebrow';
import { ColumnCard } from '@/features/ml/components/ColumnCard';
import { DropZone } from '@/features/ml/components/DropZone';
import { TargetPicker } from '@/features/ml/components/TargetPicker';
import { effectiveExclusion, useLabStore } from '@/features/ml/lab-store';

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
  const { t } = useTranslation();
  const reset = useLabStore((s) => s.reset);
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-line bg-surface p-10 text-center">
      <p className="font-display text-lg font-semibold">{t('ml.lab.errorTitle')}</p>
      <p className="max-w-md text-sm text-muted">{t('ml.lab.errorBody')}</p>
      <Button variant="outline" size="sm" onClick={reset}>
        {t('ml.lab.retry')}
      </Button>
    </div>
  );
}

function DatasetView() {
  const { t } = useTranslation();
  const meta = useLabStore((s) => s.meta);
  const profiles = useLabStore((s) => s.profiles);
  const preview = useLabStore((s) => s.preview);
  const baseline = useLabStore((s) => s.baseline);
  const leaks = useLabStore((s) => s.leaks);
  const overrides = useLabStore((s) => s.overrides);
  const target = useLabStore((s) => s.target);
  const reset = useLabStore((s) => s.reset);
  if (!meta) return null;

  const excludedCount = profiles.filter(
    (p) => effectiveExclusion({ baseline, leaks, overrides, target }, p.name) !== null,
  ).length;
  const included = profiles.length - excludedCount - (target ? 1 : 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="font-mono text-sm font-medium">{meta.name}</span>
        <span className="font-mono text-xs text-muted tabular-nums">
          {meta.rowCount.toLocaleString()} {t('ml.lab.rows')} · {meta.columnCount}{' '}
          {t('ml.lab.columns')}
        </span>
        <Badge>
          <ShieldCheck className="h-3 w-3" aria-hidden="true" />
          {t('ml.lab.readLocally')}
        </Badge>
        <Button variant="ghost" size="sm" onClick={reset} className="ml-auto">
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          {t('ml.lab.newDataset')}
        </Button>
      </div>

      <TargetPicker />

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <Eyebrow>{t('ml.lab.columnsTitle')}</Eyebrow>
          <span className="text-xs text-muted">
            {t('ml.lab.includedSummary', { included, total: profiles.length })}
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {profiles.map((profile) => (
            <ColumnCard key={profile.name} profile={profile} />
          ))}
        </div>
      </div>

      <details className="rounded-2xl border border-line bg-surface">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium select-none">
          {t('ml.lab.previewToggle', { count: preview.length })}
        </summary>
        <div className="overflow-x-auto border-t border-line">
          <table className="w-full text-left font-mono text-xs">
            <thead>
              <tr>
                {profiles.map((p) => (
                  <th key={p.name} className="bg-surface-2 px-3 py-2 font-medium whitespace-nowrap">
                    {p.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.map((row, i) => (
                <tr key={i} className="border-t border-line">
                  {profiles.map((p) => (
                    <td key={p.name} className="px-3 py-1.5 whitespace-nowrap text-muted">
                      {row[p.name]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <div>
        <Button disabled title={t('ml.lab.trainSoon')}>
          {t('ml.lab.trainSoon')}
        </Button>
      </div>
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
        {status === 'idle' && <DropZone />}
        {status === 'parsing' && <ParsingPanel />}
        {status === 'error' && <ErrorPanel />}
        {status === 'ready' && <DatasetView />}
      </Card>
    </section>
  );
}

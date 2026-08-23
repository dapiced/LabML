import { RotateCcw, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/eyebrow';
import { ColumnCard } from '@/features/ml/components/ColumnCard';
import { KeepDatasetControl } from '@/features/ml/components/KeepDatasetControl';
import { ReadFormatNotice } from '@/features/ml/components/ReadFormatNotice';
import { TargetPicker } from '@/features/ml/components/TargetPicker';
import { ExplorePanel } from '@/features/ml/components/ExplorePanel';
import { ForecastPanel } from '@/features/ml/components/ForecastPanel';
import { TrainPanel } from '@/features/ml/components/TrainPanel';
import { effectiveExclusion, useLabStore } from '@/features/ml/lab-store';

// Split out of LabSection so the whole post-load lab (training, insights,
// exploration, forecasting) stays off /ml's first-paint critical path.
export function DatasetView() {
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
        <KeepDatasetControl />
        <Button variant="ghost" size="sm" onClick={reset} className="ml-auto">
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          {t('ml.lab.newDataset')}
        </Button>
      </div>

      <ReadFormatNotice />

      <TargetPicker />

      <TrainPanel />

      <ExplorePanel />

      <ForecastPanel />

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
    </div>
  );
}

export default DatasetView;

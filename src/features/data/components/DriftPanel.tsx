import { GitCompareArrows, Loader2 } from 'lucide-react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Eyebrow } from '@/components/ui/eyebrow';
import { useDataStore } from '@/features/data/data-store';
import type { ColumnDrift, DriftSeverity } from '@/features/data/quality/drift';
import { cn } from '@/lib/utils';

function SeverityBadge({ severity }: { severity: DriftSeverity }) {
  const { t } = useTranslation();
  return (
    <Badge
      variant="outline"
      className={cn(
        severity === 'stable' && 'text-ok',
        severity === 'moderate' && 'text-copper',
        severity === 'strong' && 'font-semibold text-copper',
      )}
    >
      {t(`data.drift.severity.${severity}`)}
    </Badge>
  );
}

/** Compare a new batch against the loaded reference: schema diff + PSI. */
export function DriftPanel() {
  const { t, i18n } = useTranslation();
  const status = useDataStore((s) => s.status);
  const meta = useDataStore((s) => s.meta);
  const driftStatus = useDataStore((s) => s.driftStatus);
  const report = useDataStore((s) => s.driftReport);
  const compareMeta = useDataStore((s) => s.compareMeta);
  const loadCompareFile = useDataStore((s) => s.loadCompareFile);
  const loadCompareDemo = useDataStore((s) => s.loadCompareDemo);
  const inputRef = useRef<HTMLInputElement>(null);
  if (status !== 'ready' || !meta) return null;

  const lang = i18n.resolvedLanguage;
  const num = (v: number) => v.toLocaleString(lang, { maximumFractionDigits: 2 });
  const pct = (v: number) => (v * 100).toLocaleString(lang, { maximumFractionDigits: 1 });
  const detailOf = (column: ColumnDrift): string[] => {
    const parts: string[] = [];
    if (column.kind === 'numeric') {
      parts.push(
        t('data.drift.meanShift', {
          ref: num(column.refMean ?? 0),
          next: num(column.newMean ?? 0),
        }),
      );
    }
    if ((column.newCategories?.length ?? 0) > 0) {
      parts.push(t('data.drift.newCategories', { list: column.newCategories!.join(', ') }));
    }
    if ((column.goneCategories?.length ?? 0) > 0) {
      parts.push(t('data.drift.goneCategories', { list: column.goneCategories!.join(', ') }));
    }
    if (Math.abs(column.newMissingRatio - column.refMissingRatio) > 0.02) {
      parts.push(
        t('data.drift.missingShift', {
          ref: pct(column.refMissingRatio),
          next: pct(column.newMissingRatio),
        }),
      );
    }
    return parts;
  };
  const schemaIssues = report
    ? report.schema.added.length + report.schema.removed.length + report.schema.typeChanged.length
    : 0;

  return (
    <section
      data-testid="drift"
      className="mb-12 flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4"
    >
      <div>
        <div className="flex items-center gap-2">
          <GitCompareArrows className="h-4 w-4 text-accent" aria-hidden="true" />
          <Eyebrow>{t('data.drift.title')}</Eyebrow>
        </div>
        <p className="mt-1 max-w-3xl text-xs text-muted">
          {t('data.drift.hint', { name: meta.name })}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          data-testid="drift-browse"
          className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-sm transition-colors hover:border-accent hover:bg-accent-soft"
        >
          {t('data.drift.browse')}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.tsv,.txt,.xlsx,.xls,text/csv"
          className="sr-only"
          aria-label={t('data.drift.browse')}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) loadCompareFile(file);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => loadCompareDemo('cafe-sales-june.csv')}
          data-testid="drift-demo"
          className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 transition-colors hover:border-accent hover:bg-accent-soft"
        >
          <span className="font-mono text-xs">cafe-sales-june.csv</span>
          <Badge variant="outline">{t('data.drift.demoTag')}</Badge>
        </button>
        {driftStatus === 'parsing' && (
          <span className="flex items-center gap-2 text-sm text-muted" aria-live="polite">
            <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden="true" />
            {t('data.drift.comparing')}
          </span>
        )}
      </div>

      {driftStatus === 'done' && report && compareMeta && (
        <div className="flex flex-col gap-4" data-testid="drift-result">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <SeverityBadge severity={report.severity} />
            {t('data.drift.verdict', {
              name: compareMeta.name,
              drifted: report.driftedColumns,
              total: report.columns.length,
              refRows: report.refRows.toLocaleString(lang),
              newRows: report.newRows.toLocaleString(lang),
            })}
          </p>

          {schemaIssues > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="drift-schema">
              <span className="font-medium">{t('data.drift.schemaTitle')}</span>
              {report.schema.added.map((column) => (
                <span key={column} className="rounded-full bg-surface-2 px-2.5 py-1 font-mono">
                  + {column}
                </span>
              ))}
              {report.schema.removed.map((column) => (
                <span key={column} className="rounded-full bg-surface-2 px-2.5 py-1 font-mono">
                  − {column}
                </span>
              ))}
              {report.schema.typeChanged.map(({ column, from, to }) => (
                <span key={column} className="rounded-full bg-surface-2 px-2.5 py-1 font-mono">
                  {column}: {t(`ml.lab.type.${from}`)} → {t(`ml.lab.type.${to}`)}
                </span>
              ))}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th className="py-1.5 pr-3 font-normal">{t('data.drift.colColumn')}</th>
                  <th className="py-1.5 pr-3 font-normal">PSI</th>
                  <th className="py-1.5 pr-3 font-normal">{t('data.drift.colSeverity')}</th>
                  <th className="py-1.5 font-normal">{t('data.drift.colDetail')}</th>
                </tr>
              </thead>
              <tbody>
                {report.columns.map((column) => (
                  <tr key={column.column} className="border-b border-line last:border-b-0">
                    <td className="py-1.5 pr-3 font-mono">{column.column}</td>
                    <td className="py-1.5 pr-3 font-mono tabular-nums">
                      {column.psi.toLocaleString(lang, { maximumFractionDigits: 3 })}
                    </td>
                    <td className="py-1.5 pr-3">
                      <SeverityBadge severity={column.severity} />
                    </td>
                    <td className="py-1.5 text-muted">{detailOf(column).join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-muted">{t('data.drift.note')}</p>
        </div>
      )}
    </section>
  );
}

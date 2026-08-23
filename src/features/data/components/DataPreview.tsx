import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/card';
import { useDataStore } from '@/features/data/data-store';
import { cn } from '@/lib/utils';

/** Small before/after table preview of the dataset. */
export function DataPreview() {
  const { t } = useTranslation();
  const preview = useDataStore((s) => s.preview);
  const cleanedPreview = useDataStore((s) => s.cleanedPreview);
  const [side, setSide] = useState<'before' | 'after'>('after');

  const rows = side === 'before' ? preview : cleanedPreview;
  if (rows.length === 0) return null;
  const headers = Object.keys(rows[0]);

  return (
    <section className="flex flex-col gap-3 pb-12" data-testid="data-preview">
      <div className="flex items-center gap-3">
        <h2 className="font-display text-2xl font-semibold">{t('data.preview.title')}</h2>
        <div className="flex gap-1" role="group" aria-label={t('data.preview.title')}>
          {(['before', 'after'] as const).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={side === key}
              onClick={() => setSide(key)}
              className={cn(
                'rounded-full px-3 py-1 text-sm transition-colors',
                side === key
                  ? 'bg-accent-soft font-medium text-accent-strong'
                  : 'text-muted hover:text-ink',
              )}
            >
              {t(`data.preview.${key}`)}
            </button>
          ))}
        </div>
      </div>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              {headers.map((header) => (
                <th key={header} className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r} className="border-b border-line last:border-b-0">
                {headers.map((header) => (
                  <td key={header} className="px-3 py-1.5 whitespace-nowrap text-muted">
                    {row[header] === '' ? '—' : row[header]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-muted">{t('data.preview.note', { count: rows.length })}</p>
    </section>
  );
}

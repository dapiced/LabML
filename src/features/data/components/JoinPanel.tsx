import { Link2, Loader2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/eyebrow';
import { useDataStore } from '@/features/data/data-store';

/**
 * Left-join a second file onto the loaded dataset: the everyday enrichment
 * gesture, with honest bookkeeping — match rate, orphan keys shown by name.
 */
export function JoinPanel() {
  const { t, i18n } = useTranslation();
  const status = useDataStore((s) => s.status);
  const meta = useDataStore((s) => s.meta);
  const joinStatus = useDataStore((s) => s.joinStatus);
  const candidate = useDataStore((s) => s.joinCandidate);
  const stats = useDataStore((s) => s.joinStats);
  const loadJoinFile = useDataStore((s) => s.loadJoinFile);
  const loadJoinDemo = useDataStore((s) => s.loadJoinDemo);
  const applyJoin = useDataStore((s) => s.applyJoin);
  const inputRef = useRef<HTMLInputElement>(null);
  const [key, setKey] = useState('');
  if (status !== 'ready' || !meta) return null;

  const lang = i18n.resolvedLanguage;
  const selectedKey = key && candidate?.candidates.includes(key) ? key : candidate?.candidates[0];
  const isDemoDataset = meta.name.startsWith('cafe-sales');

  return (
    <section
      data-testid="join"
      className="mb-12 flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4"
    >
      <div>
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-accent" aria-hidden="true" />
          <Eyebrow>{t('data.join.title')}</Eyebrow>
        </div>
        <p className="mt-1 max-w-3xl text-xs text-muted">
          {t('data.join.hint', { name: meta.name })}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          data-testid="join-browse"
          className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-sm transition-colors hover:border-accent hover:bg-accent-soft"
        >
          {t('data.join.browse')}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.tsv,.txt,.xlsx,.xls,text/csv"
          className="sr-only"
          aria-label={t('data.join.browse')}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) loadJoinFile(file);
            e.target.value = '';
          }}
        />
        {isDemoDataset && (
          <button
            type="button"
            onClick={() => loadJoinDemo('cafe-products.csv')}
            data-testid="join-demo"
            className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 transition-colors hover:border-accent hover:bg-accent-soft"
          >
            <span className="font-mono text-xs">cafe-products.csv</span>
            <Badge variant="outline">{t('data.join.demoTag')}</Badge>
          </button>
        )}
        {joinStatus === 'parsing' && (
          <span className="flex items-center gap-2 text-sm text-muted" aria-live="polite">
            <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden="true" />
            {t('data.join.parsing')}
          </span>
        )}
      </div>

      {joinStatus === 'ready' && candidate && (
        <div className="flex flex-wrap items-center gap-3" data-testid="join-ready">
          <span className="font-mono text-xs text-muted">
            {candidate.name} · {candidate.rows.toLocaleString(lang)}
          </span>
          {candidate.candidates.length === 0 ? (
            <span className="text-sm text-copper">{t('data.join.noKey')}</span>
          ) : (
            <>
              <label className="flex items-center gap-2 text-sm">
                {t('data.join.keyLabel')}
                <select
                  value={selectedKey}
                  onChange={(e) => setKey(e.target.value)}
                  className="h-9 rounded-lg border border-line bg-surface px-2 font-mono text-sm"
                  data-testid="join-key"
                >
                  {candidate.candidates.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <Button size="sm" onClick={() => applyJoin(selectedKey!)} data-testid="join-apply">
                {t('data.join.apply')}
              </Button>
            </>
          )}
        </div>
      )}

      {joinStatus === 'done' && stats && (
        <div className="flex flex-col gap-3" data-testid="join-result">
          <p className="text-sm">
            {t('data.join.verdict', {
              other: stats.otherName,
              key: stats.key,
              matched: stats.matchedRows.toLocaleString(lang),
              total: (stats.matchedRows + stats.orphanRows).toLocaleString(lang),
              columns: stats.addedColumns.length,
            })}
          </p>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {stats.addedColumns.map((name) => (
              <span key={name} className="rounded-full bg-surface-2 px-2.5 py-1 font-mono">
                + {name}
              </span>
            ))}
          </div>
          {stats.orphanRows > 0 && (
            <p className="text-xs text-muted" data-testid="join-orphans">
              {t('data.join.orphans', {
                count: stats.orphanRows,
                keys: stats.orphanKeys.map((value) => `« ${value} »`).join(', '),
              })}
            </p>
          )}
          {(stats.duplicateKeys > 0 || stats.unusedRightRows > 0) && (
            <p className="text-xs text-muted">
              {stats.duplicateKeys > 0 && t('data.join.duplicates', { count: stats.duplicateKeys })}{' '}
              {stats.unusedRightRows > 0 && t('data.join.unused', { count: stats.unusedRightRows })}
            </p>
          )}
          <p className="text-xs text-muted">{t('data.join.note')}</p>
        </div>
      )}
    </section>
  );
}

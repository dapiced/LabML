import { Database, Play, TableIcon } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Eyebrow } from '@/components/ui/eyebrow';
import { useDataStore } from '@/features/data/data-store';
import { BUNDLE_BYTES, type SqlEngine } from '@/features/data/sql/engine';
import { readerFor, tableNameFor, tableToCsv, type SqlTable } from '@/features/data/sql/table';

/** Rows painted at once. The count above the table always tells the truth. */
const DISPLAY_CAP = 200;
/** The view the active file is always reachable under. */
const MAIN_VIEW = 'dataset';

type Status = 'idle' | 'loading' | 'ready' | 'failed';

function formatMb(bytes: number, lang: string): string {
  return `${(bytes / 1e6).toLocaleString(lang, { maximumFractionDigits: 0 })} MB`;
}

export function SqlPanel() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? 'en';
  const navigate = useNavigate();
  const sqlSource = useDataStore((s) => s.sqlSource);
  const sendSqlToLab = useDataStore((s) => s.sendSqlToLab);

  const engineRef = useRef<SqlEngine | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [failure, setFailure] = useState<string | null>(null);
  const [tables, setTables] = useState<string[]>([]);
  const [sql, setSql] = useState(`SELECT * FROM ${MAIN_VIEW} LIMIT 20`);
  const [result, setResult] = useState<SqlTable | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  /** Registers one file and exposes it as a view; returns the view name. */
  const attach = useCallback(
    async (engine: SqlEngine, name: string, bytes: Uint8Array, view: string): Promise<void> => {
      const reader = readerFor(name);
      if (!reader) throw new Error(`sql-unsupported-file:${name}`);
      await engine.register(name, bytes);
      // The file name goes through a SQL string literal — doubling quotes is
      // the whole escape needed, and the name never comes from a server.
      const literal = name.replace(/'/g, "''");
      await engine.run(
        `CREATE OR REPLACE VIEW "${view}" AS SELECT * FROM ${reader}('${literal}')`,
        1,
      );
    },
    [],
  );

  const open = useCallback(async () => {
    setStatus('loading');
    setFailure(null);
    try {
      const { openEngine } = await import('@/features/data/sql/engine');
      const engine = await openEngine();
      engineRef.current = engine;
      const attached: string[] = [];
      if (sqlSource) {
        const bytes = sqlSource.file
          ? new Uint8Array(await sqlSource.file.arrayBuffer())
          : new Uint8Array(await (await fetch(sqlSource.url as string)).arrayBuffer());
        await attach(engine, sqlSource.name, bytes, MAIN_VIEW);
        attached.push(MAIN_VIEW);
      }
      setTables(attached);
      setStatus('ready');
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
      setStatus('failed');
    }
  }, [attach, sqlSource]);

  const addFile = useCallback(
    async (file: File) => {
      const engine = engineRef.current;
      if (!engine) return;
      setQueryError(null);
      try {
        const view = tableNameFor(file.name);
        await attach(engine, file.name, new Uint8Array(await file.arrayBuffer()), view);
        setTables((previous) => (previous.includes(view) ? previous : [...previous, view]));
      } catch (error) {
        setQueryError(error instanceof Error ? error.message : String(error));
      }
    },
    [attach],
  );

  const run = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine || sql.trim() === '') return;
    setRunning(true);
    setQueryError(null);
    try {
      setResult(await engine.run(sql, DISPLAY_CAP));
    } catch (error) {
      // DuckDB's own message names the line and the token — far more useful
      // than anything we could paraphrase.
      setQueryError(error instanceof Error ? error.message : String(error));
      setResult(null);
    } finally {
      setRunning(false);
    }
  }, [sql]);

  const download = useCallback(() => {
    if (!result) return;
    const blob = new Blob([tableToCsv(result)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'query.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  }, [result]);

  const toLab = useCallback(() => {
    if (!result) return;
    sendSqlToLab('query.csv', tableToCsv(result));
    void navigate('/ml');
  }, [navigate, result, sendSqlToLab]);

  return (
    <Card className="flex flex-col gap-4" data-testid="sql-panel">
      <div className="flex items-center gap-2">
        <Database className="h-5 w-5 text-accent" aria-hidden="true" />
        <Eyebrow>{t('data.sql.title')}</Eyebrow>
      </div>
      <p className="max-w-3xl text-sm leading-relaxed text-muted">{t('data.sql.body')}</p>

      {status === 'idle' && (
        <div className="flex flex-col gap-2">
          <div>
            <Button onClick={() => void open()} data-testid="sql-open">
              {t('data.sql.open', { size: formatMb(BUNDLE_BYTES.eh, lang) })}
            </Button>
          </div>
          <p className="text-xs text-muted">{t('data.sql.openNote')}</p>
        </div>
      )}
      {status === 'loading' && <p className="text-sm text-muted">{t('data.sql.loading')}</p>}
      {status === 'failed' && (
        <p className="text-sm text-[var(--copper)]">{t('data.sql.failed', { reason: failure })}</p>
      )}

      {status === 'ready' && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            {tables.length > 0
              ? t('data.sql.tables', { tables: tables.join(', '), file: sqlSource?.name ?? '' })
              : t('data.sql.noSource')}
          </p>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('data.sql.queryLabel')}</span>
            <textarea
              value={sql}
              onChange={(event) => setSql(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void run();
              }}
              rows={4}
              spellCheck={false}
              data-testid="sql-input"
              className="w-full rounded-xl border border-line bg-surface-2 p-3 font-mono text-xs text-ink"
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void run()} disabled={running} data-testid="sql-run">
              <Play className="h-4 w-4" aria-hidden="true" />
              {running ? t('data.sql.running') : t('data.sql.run')}
            </Button>
            <label className={'cursor-pointer text-sm text-accent underline underline-offset-4'}>
              {t('data.sql.addFile')}
              <input
                type="file"
                accept=".csv,.tsv,.txt,.parquet,.json,.ndjson"
                className="sr-only"
                data-testid="sql-add-file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void addFile(file);
                }}
              />
            </label>
          </div>

          {queryError && (
            <pre
              data-testid="sql-error"
              className="overflow-x-auto rounded-xl bg-[var(--copper-soft)] p-3 font-mono text-xs whitespace-pre-wrap text-[var(--copper)]"
            >
              {queryError}
            </pre>
          )}

          {result && (
            <div className="flex flex-col gap-2" data-testid="sql-result">
              <p className="flex items-center gap-2 text-sm text-muted">
                <TableIcon className="h-4 w-4" aria-hidden="true" />
                {result.truncated
                  ? t('data.sql.rowsTruncated', {
                      shown: result.rows.length,
                      total: result.totalRows.toLocaleString(lang),
                    })
                  : t('data.sql.rows', { total: result.totalRows.toLocaleString(lang) })}
              </p>
              <div className="max-h-96 overflow-auto rounded-xl border border-line">
                <table className="w-full border-collapse text-left font-mono text-xs">
                  <thead className="sticky top-0 bg-surface-2">
                    <tr>
                      {result.columns.map((column) => (
                        <th key={column} className="border-b border-line px-3 py-2 font-semibold">
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, index) => (
                      <tr key={index} className="odd:bg-surface-2/40">
                        {row.map((cell, cellIndex) => (
                          <td key={cellIndex} className="border-b border-line px-3 py-1.5">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={download}>
                  {t('data.sql.exportCsv')}
                </Button>
                <Button variant="outline" size="sm" onClick={toLab} data-testid="sql-to-lab">
                  {t('data.sql.toLab')}
                </Button>
              </div>
              {result.truncated && <p className="text-xs text-muted">{t('data.sql.capNote')}</p>}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export default SqlPanel;

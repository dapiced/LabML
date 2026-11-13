import { Database, Play, TableIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Eyebrow } from '@/components/ui/eyebrow';
import { useDataStore } from '@/features/data/data-store';
import { BUNDLE_BYTES, type SqlEngine } from '@/features/data/sql/engine';
import {
  exportableQuery,
  queryFileName,
  readerFor,
  tableNameFor,
  type SqlTable,
} from '@/features/data/sql/table';
import { MAX_CELLS } from '@/features/ml/data/limits';
import { ScrollRegion } from '@/components/ui/scroll-region';
import { downloadFile } from '@/lib/download';

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
  const mountedRef = useRef(true);
  const [status, setStatus] = useState<Status>('idle');
  const [failure, setFailure] = useState<string | null>(null);
  const [tables, setTables] = useState<string[]>([]);
  const [sql, setSql] = useState(`SELECT * FROM ${MAIN_VIEW} LIMIT 20`);
  const [result, setResult] = useState<SqlTable | null>(null);
  // V69: the query behind the result on screen. An export runs THIS, not the
  // text of the box, which may have been edited since.
  const [resultSql, setResultSql] = useState('');
  const [exporting, setExporting] = useState<'csv' | 'parquet' | 'lab' | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  // V47: DuckDB runs in its own worker with its own Wasm heap. Nothing closed
  // it, so every visit to the panel left one more engine behind.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const engine = engineRef.current;
      engineRef.current = null;
      void engine?.close().catch(() => undefined);
    };
  }, []);

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
    // A retry replaces the engine: the previous one is closed, not orphaned.
    const previous = engineRef.current;
    engineRef.current = null;
    void previous?.close().catch(() => undefined);
    let engine: SqlEngine | null = null;
    try {
      const { openEngine } = await import('@/features/data/sql/engine');
      engine = await openEngine();
      if (!mountedRef.current) {
        // The panel was left while the engine was starting.
        void engine.close().catch(() => undefined);
        return;
      }
      engineRef.current = engine;
      const attached: string[] = [];
      if (sqlSource) {
        const bytes = sqlSource.file
          ? new Uint8Array(await sqlSource.file.arrayBuffer())
          : new Uint8Array(await (await fetch(sqlSource.url as string)).arrayBuffer());
        await attach(engine, sqlSource.name, bytes, MAIN_VIEW);
        attached.push(MAIN_VIEW);
      }
      if (!mountedRef.current) return;
      setTables(attached);
      setStatus('ready');
    } catch (error) {
      if (engine && engineRef.current === engine) {
        engineRef.current = null;
        void engine.close().catch(() => undefined);
      }
      if (!mountedRef.current) return;
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
      setExportError(null);
      setResult(await engine.run(sql, DISPLAY_CAP));
      setResultSql(sql);
    } catch (error) {
      // DuckDB's own message names the line and the token — far more useful
      // than anything we could paraphrase.
      setQueryError(error instanceof Error ? error.message : String(error));
      setResult(null);
    } finally {
      setRunning(false);
    }
  }, [sql]);

  /**
   * V69: an export is the query, not the screen. The console paints 200 rows;
   * the engine writes every row the query returns, under the lab's own cell
   * budget (V54) so a result the lab would refuse is not built at all.
   */
  const exportResult = useCallback(
    async (kind: 'csv' | 'parquet' | 'lab') => {
      const engine = engineRef.current;
      if (!engine || !result || exporting) return;
      if (result.totalRows * result.columns.length > MAX_CELLS) {
        setExportError(
          t('data.sql.tooLarge', {
            rows: result.totalRows.toLocaleString(lang),
            columns: result.columns.length,
            budget: MAX_CELLS.toLocaleString(lang),
          }),
        );
        return;
      }
      setExporting(kind);
      setExportError(null);
      try {
        const query = exportableQuery(resultSql);
        if (kind === 'parquet') {
          const bytes = await engine.toParquet(query);
          downloadFile(
            queryFileName(resultSql, 'parquet'),
            bytes as BlobPart,
            'application/vnd.apache.parquet',
          );
          return;
        }
        const csv = await engine.toCsv(query);
        const name = queryFileName(resultSql, 'csv');
        if (kind === 'csv') {
          downloadFile(name, csv, 'text/csv');
        } else if (mountedRef.current) {
          sendSqlToLab(name, csv);
          void navigate('/ml');
        }
      } catch (error) {
        if (mountedRef.current) {
          setExportError(
            t('data.sql.exportFailed', {
              reason: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      } finally {
        if (mountedRef.current) setExporting(null);
      }
    },
    [exporting, lang, navigate, result, resultSql, sendSqlToLab, t],
  );

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
              <ScrollRegion className="max-h-96 overflow-y-auto rounded-xl border border-line">
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
              </ScrollRegion>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={exporting !== null}
                  onClick={() => void exportResult('csv')}
                  data-testid="sql-export-csv"
                >
                  {t('data.sql.exportCsv')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={exporting !== null}
                  onClick={() => void exportResult('parquet')}
                  data-testid="sql-export-parquet"
                >
                  {t('data.sql.exportParquet')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={exporting !== null}
                  onClick={() => void exportResult('lab')}
                  data-testid="sql-to-lab"
                >
                  {t('data.sql.toLab')}
                </Button>
                {exporting !== null && (
                  <span className="text-xs text-muted" aria-live="polite">
                    {t('data.sql.exporting', { total: result.totalRows.toLocaleString(lang) })}
                  </span>
                )}
              </div>
              {exportError && (
                <p className="text-xs text-[var(--copper)]" data-testid="sql-export-error">
                  {exportError}
                </p>
              )}
              <p className="text-xs text-muted" data-testid="sql-export-note">
                {t(result.truncated ? 'data.sql.capNote' : 'data.sql.exportNote', {
                  total: result.totalRows.toLocaleString(lang),
                })}
              </p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export default SqlPanel;

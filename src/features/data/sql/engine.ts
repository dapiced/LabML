/**
 * V29 — DuckDB-Wasm, opened on demand and served entirely from our origin.
 *
 * Three LabML constraints shape this file:
 *
 * 1. The library's default is jsDelivr; the strict CSP (`connect-src 'self'`)
 *    refuses it, so the bundle paths below are ours, copied at build time.
 * 2. No COOP/COEP headers and no SharedArrayBuffer, so the `coi` (threaded)
 *    build is not shipped — single-threaded is the assumed mode, not a
 *    degraded one.
 * 3. duckdb-wasm is pinned to 1.28.0: from 1.29 the binaries pass Cloudflare
 *    Pages' 25 MiB per-file limit. See vite.config.ts for the measurement.
 */
import type { SqlTable } from '@/features/data/sql/table';
import { toSqlTable } from '@/features/data/sql/table';

/** Announced to the user before the download starts (bytes, decimal MB). */
export const BUNDLE_BYTES: Record<'eh' | 'mvp', number> = {
  eh: 18_157_568,
  mvp: 22_167_552,
};

export interface SqlEngine {
  /** Which build this browser can run — `mvp` lacks exception handling. */
  readonly flavour: 'eh' | 'mvp';
  /** Makes a file readable by SQL under `name`; the bytes stay in the tab. */
  register(name: string, bytes: Uint8Array): Promise<void>;
  run(sql: string, cap: number): Promise<SqlTable>;
  close(): Promise<void>;
}

export async function openEngine(): Promise<SqlEngine> {
  const duckdb = await import('@duckdb/duckdb-wasm');
  const bundles = {
    mvp: {
      mainModule: '/duckdb/duckdb-mvp.wasm',
      mainWorker: '/duckdb/duckdb-browser-mvp.worker.js',
    },
    eh: {
      mainModule: '/duckdb/duckdb-eh.wasm',
      mainWorker: '/duckdb/duckdb-browser-eh.worker.js',
    },
  };
  const bundle = await duckdb.selectBundle(bundles);
  const flavour: 'eh' | 'mvp' = bundle.mainModule.includes('eh') ? 'eh' : 'mvp';
  if (!bundle.mainWorker) throw new Error('duckdb-no-worker');

  const worker = new Worker(bundle.mainWorker);
  const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  const connection = await db.connect();

  return {
    flavour,
    async register(name, bytes) {
      await db.registerFileBuffer(name, bytes);
    },
    async run(sql, cap) {
      // Arrow's own types are structurally loose here; the narrow shapes we
      // actually use are spelled out so the formatting layer stays typed.
      const result = (await connection.query(sql)) as unknown as {
        schema: { fields: { name: unknown }[] };
        toArray(): { toJSON(): Record<string, unknown> }[];
      };
      const columns = result.schema.fields.map((field) => String(field.name));
      const records = result.toArray().map((row) => row.toJSON());
      return toSqlTable(columns, records, cap);
    },
    async close() {
      await connection.close();
      await db.terminate();
      worker.terminate();
    },
  };
}

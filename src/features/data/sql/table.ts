/**
 * V29 — turning a query result into something a table can render.
 *
 * DuckDB hands back Arrow, whose cells are not strings: 64-bit integers arrive
 * as BigInt (JSON.stringify throws on those), timestamps as Date, BLOBs as
 * bytes, and NULL as null — which must stay visibly different from the empty
 * string, or a query result would quietly lie about missing values.
 *
 * Pure functions, so the formatting is unit-tested rather than eyeballed in a
 * browser.
 */
import { toCsv } from '@/lib/csv';

export interface SqlTable {
  columns: string[];
  /** At most `cap` rows — what the UI paints. */
  rows: string[][];
  /** Rows the query actually returned, however many are shown. */
  totalRows: number;
  /** True when the display was capped, so the UI can say so. */
  truncated: boolean;
}

/** The marker for SQL NULL — never the empty string, which is a real value. */
export const NULL_CELL = '∅';

export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return NULL_CELL;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array)
    return `0x${[...value.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('')}${value.length > 8 ? '…' : ''}`;
  if (typeof value === 'object') {
    // Arrow nests structs, lists and decimals; their toString is more useful
    // than "[object Object]", and JSON.stringify would throw on a BigInt.
    try {
      return JSON.stringify(value, (_key, inner) =>
        typeof inner === 'bigint' ? inner.toString() : inner,
      );
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function toSqlTable(
  columns: readonly string[],
  records: readonly Record<string, unknown>[],
  cap: number,
): SqlTable {
  const rows = records.slice(0, cap).map((record) => columns.map((c) => formatCell(record[c])));
  return {
    columns: [...columns],
    rows,
    totalRows: records.length,
    truncated: records.length > cap,
  };
}

/** RFC-4180-ish escaping, matching what the Data Studio exports elsewhere. */
export function tableToCsv(table: SqlTable): string {
  return toCsv(table.columns, table.rows);
}

/**
 * The reader (`read_csv_auto`, `read_parquet`, `read_json_auto`) DuckDB needs
 * for a dropped file. Unknown extensions are refused by name rather than
 * guessed — a Parquet file read as CSV produces garbage, not an error.
 */
export function readerFor(fileName: string): string | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.tsv') || lower.endsWith('.txt')) {
    return 'read_csv_auto';
  }
  if (lower.endsWith('.parquet')) return 'read_parquet';
  if (lower.endsWith('.json') || lower.endsWith('.ndjson')) return 'read_json_auto';
  return null;
}

/** A SQL identifier for a dropped file: `cafe-sales.csv` → `cafe_sales`. */
export function tableNameFor(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '');
  const cleaned = base.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(?=\d)/, 't_');
  return cleaned.length > 0 ? cleaned.toLowerCase() : 'dropped';
}

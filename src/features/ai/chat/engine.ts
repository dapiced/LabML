/**
 * The deterministic query engine behind /ai/chat: a parsed intent is executed
 * against the raw columns (missing tokens skipped, numbers parsed like
 * everywhere else in LabML). Pure functions — no DOM, no randomness.
 */
import { isMissing, parseNumber } from '@/features/ml/data/infer';
import type { Cell } from '@/features/ml/data/types';

export type AggOp = 'count' | 'mean' | 'median' | 'min' | 'max' | 'sum' | 'std';

export type FilterOp = '>' | '>=' | '<' | '<=' | '=' | '!=';

export interface Filter {
  column: string;
  op: FilterOp;
  value: string | number;
}

export type Intent =
  | { kind: 'aggregate'; op: AggOp; column: string; groupBy?: string; filter?: Filter }
  | { kind: 'count'; filter?: Filter }
  | { kind: 'topk'; groupBy: string; k: number; op: AggOp; column?: string; filter?: Filter }
  | { kind: 'distribution'; column: string }
  | { kind: 'correlation'; a: string; b: string }
  | { kind: 'shape' }
  | { kind: 'missing' };

export interface GroupRow {
  key: string;
  value: number;
  count: number;
  /**
   * V27.2 — how many of those rows actually carried a usable number. Set only
   * when it differs from `count`: an average over a column with holes is not
   * an average over every row of the group, and the answer must not imply it.
   */
  used?: number;
}

export interface QueryResult {
  intent: Intent;
  /** Rows remaining after the filter (all rows when unfiltered). */
  rowsConsidered: number;
  /**
   * V27.2 — values a scalar aggregate actually averaged/summed. Missing and
   * unparseable cells are skipped, so on Titanic's `age` this is 714 where
   * `rowsConsidered` is 891. Set only when the two differ — the sentence then
   * says both numbers instead of implying every row had a value.
   */
  valuesUsed?: number;
  scalar?: number;
  groups?: GroupRow[];
  distribution?: { label: string; count: number }[];
  correlation?: number;
  shape?: { rows: number; columns: number };
  missing?: { column: string; count: number }[];
}

export interface Table {
  header: string[];
  columns: Cell[][];
}

const TOP_DISTRIBUTION = 8;
const MAX_GROUPS = 12;

function columnIndex(table: Table, name: string): number {
  const index = table.header.indexOf(name);
  if (index < 0) throw new Error(`unknown-column:${name}`);
  return index;
}

function matchesFilter(cell: Cell, filter: Filter): boolean {
  if (isMissing(cell)) return false;
  const raw = (cell as string).trim();
  if (typeof filter.value === 'number') {
    const parsed = parseNumber(raw);
    if (parsed === null) return false;
    switch (filter.op) {
      case '>':
        return parsed > filter.value;
      case '>=':
        return parsed >= filter.value;
      case '<':
        return parsed < filter.value;
      case '<=':
        return parsed <= filter.value;
      case '=':
        return parsed === filter.value;
      case '!=':
        return parsed !== filter.value;
    }
  }
  const equal = raw.toLowerCase() === String(filter.value).toLowerCase();
  return filter.op === '!=' ? !equal : equal;
}

function filteredRows(table: Table, filter?: Filter): number[] {
  const total = table.columns[0]?.length ?? 0;
  if (!filter) return Array.from({ length: total }, (_, i) => i);
  const values = table.columns[columnIndex(table, filter.column)];
  const rows: number[] = [];
  for (let i = 0; i < total; i++) {
    if (matchesFilter(values[i], filter)) rows.push(i);
  }
  return rows;
}

export function aggregate(values: number[], op: AggOp): number {
  if (op === 'count') return values.length;
  if (values.length === 0) return Number.NaN;
  switch (op) {
    case 'sum':
      return values.reduce((a, v) => a + v, 0);
    case 'mean':
      return values.reduce((a, v) => a + v, 0) / values.length;
    case 'min':
      return Math.min(...values);
    case 'max':
      return Math.max(...values);
    case 'median': {
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }
    case 'std': {
      const mean = values.reduce((a, v) => a + v, 0) / values.length;
      return Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length);
    }
  }
}

function numericAt(table: Table, column: string, rows: number[]): number[] {
  const values = table.columns[columnIndex(table, column)];
  const numbers: number[] = [];
  for (const row of rows) {
    const cell = values[row];
    if (isMissing(cell)) continue;
    const parsed = parseNumber((cell as string).trim());
    if (parsed !== null) numbers.push(parsed);
  }
  return numbers;
}

function groupRows(table: Table, groupBy: string, rows: number[]): Map<string, number[]> {
  const values = table.columns[columnIndex(table, groupBy)];
  const groups = new Map<string, number[]>();
  for (const row of rows) {
    const cell = values[row];
    if (isMissing(cell)) continue;
    const key = (cell as string).trim();
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

/** Pearson correlation over rows where both columns are numeric. */
export function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return Number.NaN;
  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < n; i++) {
    sumA += a[i];
    sumB += b[i];
  }
  const meanA = sumA / n;
  const meanB = sumB / n;
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  const denominator = Math.sqrt(varA * varB);
  return denominator === 0 ? Number.NaN : cov / denominator;
}

export function runQuery(table: Table, intent: Intent): QueryResult {
  if (intent.kind === 'shape') {
    return {
      intent,
      rowsConsidered: table.columns[0]?.length ?? 0,
      shape: { rows: table.columns[0]?.length ?? 0, columns: table.header.length },
    };
  }

  if (intent.kind === 'missing') {
    const missing = table.header
      .map((column, i) => ({
        column,
        count: table.columns[i].reduce((acc: number, cell) => acc + (isMissing(cell) ? 1 : 0), 0),
      }))
      .filter((entry) => entry.count > 0)
      .sort((a, b) => b.count - a.count || a.column.localeCompare(b.column));
    return { intent, rowsConsidered: table.columns[0]?.length ?? 0, missing };
  }

  if (intent.kind === 'correlation') {
    const rows = filteredRows(table);
    const colA = table.columns[columnIndex(table, intent.a)];
    const colB = table.columns[columnIndex(table, intent.b)];
    const a: number[] = [];
    const b: number[] = [];
    for (const row of rows) {
      if (isMissing(colA[row]) || isMissing(colB[row])) continue;
      const va = parseNumber((colA[row] as string).trim());
      const vb = parseNumber((colB[row] as string).trim());
      if (va === null || vb === null) continue;
      a.push(va);
      b.push(vb);
    }
    return { intent, rowsConsidered: a.length, correlation: pearson(a, b) };
  }

  if (intent.kind === 'distribution') {
    const rows = filteredRows(table);
    const values = table.columns[columnIndex(table, intent.column)];
    const counts = new Map<string, number>();
    for (const row of rows) {
      if (isMissing(values[row])) continue;
      const key = (values[row] as string).trim();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const distribution = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, TOP_DISTRIBUTION)
      .map(([label, count]) => ({ label, count }));
    return { intent, rowsConsidered: rows.length, distribution };
  }

  if (intent.kind === 'count') {
    const rows = filteredRows(table, intent.filter);
    return { intent, rowsConsidered: rows.length, scalar: rows.length };
  }

  if (intent.kind === 'topk') {
    const rows = filteredRows(table, intent.filter);
    const groups = groupRows(table, intent.groupBy, rows);
    const entries: GroupRow[] = [];
    for (const [key, members] of groups) {
      if (intent.op === 'count' || !intent.column) {
        entries.push({ key, value: members.length, count: members.length });
        continue;
      }
      const numbers = numericAt(table, intent.column, members);
      const value = aggregate(numbers, intent.op);
      if (Number.isNaN(value)) continue;
      entries.push({
        key,
        value,
        count: members.length,
        ...(numbers.length !== members.length && { used: numbers.length }),
      });
    }
    entries.sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
    return { intent, rowsConsidered: rows.length, groups: entries.slice(0, intent.k) };
  }

  // aggregate
  const rows = filteredRows(table, intent.filter);
  if (intent.groupBy) {
    const groups = groupRows(table, intent.groupBy, rows);
    const entries: GroupRow[] = [];
    for (const [key, members] of groups) {
      const numbers = numericAt(table, intent.column, members);
      const value = aggregate(numbers, intent.op);
      if (Number.isNaN(value)) continue;
      entries.push({
        key,
        value,
        count: members.length,
        ...(numbers.length !== members.length && { used: numbers.length }),
      });
    }
    entries.sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
    return { intent, rowsConsidered: rows.length, groups: entries.slice(0, MAX_GROUPS) };
  }
  const numbers = numericAt(table, intent.column, rows);
  const scalar = aggregate(numbers, intent.op);
  return {
    intent,
    rowsConsidered: rows.length,
    scalar,
    ...(numbers.length !== rows.length && { valuesUsed: numbers.length }),
  };
}

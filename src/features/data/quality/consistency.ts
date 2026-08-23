/**
 * V40: cross-column consistency — rows where two columns contradict each other.
 *
 * A delivery date before its order date, a total that is not quantity × price:
 * every value is present, correctly typed, individually plausible, and the ROW
 * is still impossible. Validity checks one column at a time and cannot see it.
 *
 * **Why this is not SQL.** The plan proposed running these rules through V29's
 * DuckDB, since the file is already registered there. Building it made the cost
 * obvious: DuckDB is an announced, opt-in 18–22 MB download, so routing these
 * checks through it would make a universally applicable check conditional on a
 * large download the user may well decline — a quality panel that is empty for
 * most people. Comparing two columns of a table already in memory is a loop, so
 * it is a loop, and every user gets it. DuckDB keeps the job it is genuinely
 * needed for: arbitrary SQL, and the Parquet export.
 *
 * The rules follow the same two laws as `validity.ts`: they fire on evidence
 * rather than on column names alone, and they report without ever repairing.
 */
import { isMissing, parseNumber } from '@/features/ml/data/infer';
import { parseDate } from '@/features/ml/timeseries/series';
import { MAX_EXAMPLE_ROWS, APPLICABILITY } from '@/features/data/quality/validity';
import type { Cell } from '@/features/ml/data/types';

export type ConsistencyRule =
  /** An "end" date strictly before its matching "start" date. */
  | 'dateOrder'
  /** A total that does not match quantity × unit price. */
  | 'productMismatch';

export interface ConsistencyFinding {
  rule: ConsistencyRule;
  /** The columns the rule compared, in the order it compared them. */
  columns: string[];
  rows: number[];
  count: number;
  /** One rendered example per listed row, e.g. « 2025-01-04 → 2024-12-30 ». */
  examples: string[];
}

/** Relative tolerance on the product rule — money is rounded, not exact. */
export const PRODUCT_TOLERANCE = 0.01;

function normalize(column: string): string {
  return column.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const START_HINTS = ['debut', 'start', 'commande', 'order', 'creation', 'created', 'from'] as const;
const END_HINTS = ['fin', 'end', 'livraison', 'delivery', 'cloture', 'closed', 'to'] as const;
const QUANTITY_HINTS = ['quantity', 'quantite', 'qte', 'qty', 'nombre'] as const;
const UNIT_PRICE_HINTS = [
  'unit_price',
  'prix_unitaire',
  'unitprice',
  'prixunitaire',
  'pu',
] as const;
const TOTAL_HINTS = ['total', 'montant', 'amount', 'sum'] as const;

function findColumn(header: readonly string[], hints: readonly string[]): number {
  return header.findIndex((name) => hints.some((hint) => normalize(name).includes(hint)));
}

/** Parses a whole column as dates, or returns null when it is not one. */
function asDates(values: Cell[]): (number | null)[] | null {
  const parsed: (number | null)[] = [];
  let usable = 0;
  let ok = 0;
  for (const value of values) {
    if (isMissing(value)) {
      parsed.push(null);
      continue;
    }
    usable += 1;
    const at = parseDate((value as string).trim());
    parsed.push(at);
    if (at !== null) ok += 1;
  }
  if (usable === 0 || ok / usable < APPLICABILITY) return null;
  return parsed;
}

function asNumbers(values: Cell[]): (number | null)[] | null {
  const parsed: (number | null)[] = [];
  let usable = 0;
  let ok = 0;
  for (const value of values) {
    if (isMissing(value)) {
      parsed.push(null);
      continue;
    }
    usable += 1;
    const number = parseNumber((value as string).trim());
    parsed.push(number);
    if (number !== null) ok += 1;
  }
  if (usable === 0 || ok / usable < APPLICABILITY) return null;
  return parsed;
}

function build(
  rule: ConsistencyRule,
  columns: string[],
  failures: { row: number; example: string }[],
): ConsistencyFinding | null {
  if (failures.length === 0) return null;
  const capped = failures.slice(0, MAX_EXAMPLE_ROWS);
  return {
    rule,
    columns,
    rows: capped.map((f) => f.row),
    examples: capped.map((f) => f.example),
    count: failures.length,
  };
}

export function checkConsistency(
  header: readonly string[],
  columns: Cell[][],
): ConsistencyFinding[] {
  const found: ConsistencyFinding[] = [];

  const startAt = findColumn(header, START_HINTS);
  const endAt = findColumn(header, END_HINTS);
  if (startAt >= 0 && endAt >= 0 && startAt !== endAt) {
    const start = asDates(columns[startAt] ?? []);
    const end = asDates(columns[endAt] ?? []);
    if (start && end) {
      const failures: { row: number; example: string }[] = [];
      for (let row = 0; row < start.length; row++) {
        const from = start[row];
        const to = end[row];
        // A missing endpoint is a MISSING value, already reported as one:
        // counting it here too would charge the same row twice.
        if (from === null || to === null) continue;
        if (to < from) {
          failures.push({
            row,
            example: `${String(columns[startAt][row])} → ${String(columns[endAt][row])}`,
          });
        }
      }
      const finding = build('dateOrder', [header[startAt], header[endAt]], failures);
      if (finding) found.push(finding);
    }
  }

  const qtyAt = findColumn(header, QUANTITY_HINTS);
  const unitAt = findColumn(header, UNIT_PRICE_HINTS);
  const totalAt = findColumn(header, TOTAL_HINTS);
  if (qtyAt >= 0 && unitAt >= 0 && totalAt >= 0 && totalAt !== unitAt) {
    const qty = asNumbers(columns[qtyAt] ?? []);
    const unit = asNumbers(columns[unitAt] ?? []);
    const total = asNumbers(columns[totalAt] ?? []);
    if (qty && unit && total) {
      const failures: { row: number; example: string }[] = [];
      let comparable = 0;
      for (let row = 0; row < qty.length; row++) {
        const q = qty[row];
        const u = unit[row];
        const t = total[row];
        if (q === null || u === null || t === null) continue;
        comparable += 1;
        const expected = q * u;
        // Relative tolerance, because a rounded total is not a wrong total.
        const slack = Math.max(Math.abs(expected) * PRODUCT_TOLERANCE, 0.01);
        if (Math.abs(t - expected) > slack) {
          failures.push({ row, example: `${q} × ${u} ≠ ${t}` });
        }
      }
      // If most rows disagree, these three columns are not quantity, price and
      // total — the rule has misread the file and says nothing rather than
      // flagging every row of it.
      if (comparable > 0 && failures.length / comparable <= 1 - APPLICABILITY) {
        const finding = build(
          'productMismatch',
          [header[qtyAt], header[unitAt], header[totalAt]],
          failures,
        );
        if (finding) found.push(finding);
      }
    }
  }

  return found.sort((a, b) => b.count - a.count);
}

/** Impossible rows across every consistency rule — what the score charges for. */
export function inconsistentRowCount(findings: readonly ConsistencyFinding[]): number {
  return findings.reduce((total, finding) => total + finding.count, 0);
}

/**
 * V40: validity — the third question, after completeness and type.
 *
 * The studio already asks « is the value there? » (missing) and « is it the
 * right shape? » (type). Neither catches a value that is present, correctly
 * typed, and still impossible: an age of 200, a delivery date in 2087, a
 * percentage at 130, a postcode of four characters. Those pass every check
 * the report performs today and go straight into a model.
 *
 * Two rules shape this module, and they are the same two that shaped V38's
 * reader:
 *
 * 1. **A rule fires on evidence, never on a column's name alone.** A column
 *    called `age` holding 20 000 is a duration in days, not a person; a rule
 *    that trusted the name would flag every row of a perfectly good file. So
 *    a name makes a rule *applicable*, and the values decide whether it fires.
 * 2. **Flagging is not cleaning.** Every finding names the rule, the column,
 *    how many rows failed and which ones — and then stops. V39's recipe is
 *    where data gets changed, deliberately and reproducibly; a check that
 *    quietly repaired what it found would put edits outside the recipe, which
 *    is the one record of what was done.
 */
import { isMissing, parseNumber } from '@/features/ml/data/infer';
import { parseDate } from '@/features/ml/timeseries/series';
import type { Cell } from '@/features/ml/data/types';

/** Rows listed per finding — enough to inspect, not enough to flood the UI. */
export const MAX_EXAMPLE_ROWS = 10;
/**
 * A rule must apply to enough of a column to be about the column rather than
 * about a handful of odd cells: below this share of usable values matching the
 * rule's own shape, the rule does not consider itself applicable at all.
 */
export const APPLICABILITY = 0.8;

export type ValidityRule =
  /** A human age outside 0–120. */
  | 'ageRange'
  /** A date after today — a birth date or a sale cannot be in the future. */
  | 'futureDate'
  /** A percentage outside 0–100. */
  | 'percentRange'
  /** A quantity, price or amount below zero. */
  | 'negativeAmount'
  /** A Canadian or French postcode that does not have the right shape. */
  | 'postcodeShape';

export interface ValidityFinding {
  rule: ValidityRule;
  column: string;
  /** Rows that failed, 0-based, capped at MAX_EXAMPLE_ROWS. */
  rows: number[];
  /** How many rows failed in total — `rows` may be a prefix of this. */
  count: number;
  /** Values that failed, aligned with `rows`, for display. */
  examples: string[];
  /** The bound the rule enforced, when it has one — shown in the message. */
  bound?: { min?: number; max?: number };
}

/** Column names a rule is willing to look at, matched loosely and accent-free. */
function nameMatches(column: string, needles: readonly string[]): boolean {
  const normalized = column.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return needles.some((needle) => normalized.includes(needle));
}

function usableValues(values: Cell[]): { row: number; value: string }[] {
  const out: { row: number; value: string }[] = [];
  for (let row = 0; row < values.length; row++) {
    const value = values[row];
    if (isMissing(value)) continue;
    out.push({ row, value: (value as string).trim() });
  }
  return out;
}

function finding(
  rule: ValidityRule,
  column: string,
  failures: { row: number; value: string }[],
  bound?: { min?: number; max?: number },
): ValidityFinding | null {
  if (failures.length === 0) return null;
  const capped = failures.slice(0, MAX_EXAMPLE_ROWS);
  return {
    rule,
    column,
    rows: capped.map((f) => f.row),
    examples: capped.map((f) => f.value),
    count: failures.length,
    ...(bound !== undefined && { bound }),
  };
}

const AGE_NAMES = ['age', 'âge'] as const;
const PERCENT_NAMES = ['percent', 'pourcent', 'pct', 'taux', 'rate'] as const;
const AMOUNT_NAMES = [
  'price',
  'prix',
  'montant',
  'amount',
  'total',
  'quantity',
  'quantite',
] as const;
const POSTCODE_NAMES = ['postcode', 'postal', 'zip', 'cp'] as const;
const DATE_NAMES = ['date', 'jour', 'day'] as const;

/** Canadian `H2X 1Y4` or French `75008`. */
const CANADIAN = /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/;
const FRENCH_POSTCODE = /^\d{5}$/;

/** The bound each ranged rule enforces; the others have a shape, not a bound. */
const BOUNDS: Partial<Record<ValidityRule, { min?: number; max?: number }>> = {
  ageRange: { min: 0, max: 120 },
  percentRange: { min: 0, max: 100 },
  negativeAmount: { min: 0 },
};

export function boundOf(rule: ValidityRule): { min?: number; max?: number } | undefined {
  return BOUNDS[rule];
}

const isPostcode = (value: string) => CANADIAN.test(value) || FRENCH_POSTCODE.test(value);

function numericValues(usable: { row: number; value: string }[]) {
  return usable
    .map((entry) => ({ ...entry, parsed: parseNumber(entry.value) }))
    .filter((entry): entry is typeof entry & { parsed: number } => entry.parsed !== null);
}

/**
 * V63: one rule applied to a column WITHOUT asking whether it applies. The
 * failures, and how many values the rule could read at all.
 *
 * `checkColumn` asks first, and must: on an unknown file a column named `age`
 * holding 20 000 is a duration, not a crowd of impossible people. A data
 * contract has already been told the column holds ages, and needs the answer
 * the guard withholds. Measured on the demos: once 20 % of a column is
 * impossible, the guarded rule stops applying and reports nothing at all, 178
 * ages of 999 on titanic included.
 */
export function applyRule(
  rule: ValidityRule,
  values: Cell[],
  now = Date.now(),
): { failures: { row: number; value: string }[]; tested: number } {
  const usable = usableValues(values);
  if (rule === 'futureDate') {
    const dates = usable
      .map((entry) => ({ ...entry, at: parseDate(entry.value) }))
      .filter((entry): entry is typeof entry & { at: number } => entry.at !== null);
    return { failures: dates.filter((d) => d.at > now), tested: dates.length };
  }
  if (rule === 'postcodeShape') {
    return { failures: usable.filter((entry) => !isPostcode(entry.value)), tested: usable.length };
  }
  const numbers = numericValues(usable);
  const { min, max } = BOUNDS[rule] ?? {};
  return {
    failures: numbers.filter(
      (n) => (min !== undefined && n.parsed < min) || (max !== undefined && n.parsed > max),
    ),
    tested: numbers.length,
  };
}

/**
 * The rules that apply to a column: its name makes a rule a candidate, its
 * values decide. Exactly the guards `checkColumn` has always used.
 */
export function applicableRules(column: string, values: Cell[]): ValidityRule[] {
  const usable = usableValues(values);
  if (usable.length === 0) return [];
  const rules: ValidityRule[] = [];

  const numbers = numericValues(usable);
  const numericEnough = numbers.length / usable.length >= APPLICABILITY;
  const mostly = (keep: (value: number) => boolean) =>
    numbers.filter((n) => keep(n.parsed)).length / numbers.length >= APPLICABILITY;

  // A column of ages that is mostly above 120 is not ages — it is a duration
  // in months or days, and flagging every row of it would be the rule being
  // wrong, not the data.
  if (numericEnough && nameMatches(column, AGE_NAMES) && mostly((v) => v >= 0 && v <= 120)) {
    rules.push('ageRange');
  }
  // Same guard: a rate written as 0–1 is not a percentage out of range.
  if (numericEnough && nameMatches(column, PERCENT_NAMES) && mostly((v) => v >= 0 && v <= 100)) {
    rules.push('percentRange');
  }
  // A ledger column that is routinely negative is a balance, not an error.
  if (numericEnough && nameMatches(column, AMOUNT_NAMES) && mostly((v) => v >= 0)) {
    rules.push('negativeAmount');
  }
  if (nameMatches(column, DATE_NAMES)) {
    const dates = usable.filter((entry) => parseDate(entry.value) !== null);
    if (dates.length / usable.length >= APPLICABILITY) rules.push('futureDate');
  }
  // Only a column that is mostly postcodes gets to have malformed ones.
  if (nameMatches(column, POSTCODE_NAMES)) {
    const shaped = usable.filter((entry) => isPostcode(entry.value));
    if (shaped.length / usable.length >= APPLICABILITY) rules.push('postcodeShape');
  }
  return rules;
}

/**
 * Every validity finding for one column. `now` is injected so a test can pin
 * "the future" to a fixed instant rather than depending on the clock.
 */
export function checkColumn(column: string, values: Cell[], now = Date.now()): ValidityFinding[] {
  const found: ValidityFinding[] = [];
  for (const rule of applicableRules(column, values)) {
    const result = finding(rule, column, applyRule(rule, values, now).failures, BOUNDS[rule]);
    if (result) found.push(result);
  }
  return found;
}

/** Every finding across the dataset, worst first. */
export function checkValidity(
  header: readonly string[],
  columns: Cell[][],
  now = Date.now(),
): ValidityFinding[] {
  const found: ValidityFinding[] = [];
  for (let i = 0; i < header.length; i++) {
    found.push(...checkColumn(header[i], columns[i] ?? [], now));
  }
  return found.sort((a, b) => b.count - a.count || a.column.localeCompare(b.column));
}

/** Total impossible cells — what the quality score charges for. */
export function invalidCellCount(findings: readonly ValidityFinding[]): number {
  return findings.reduce((total, finding) => total + finding.count, 0);
}

/**
 * V63: the data contract.
 *
 * The quality report answers « does this file look clean? ». A contract
 * answers « is this still the file we agreed on? ». The difference is not a
 * matter of taste: the report's rules decide for themselves whether they
 * apply, and they must, since on an unknown file a column named `age` holding
 * 20 000 is a duration and not a crowd of impossible people. Measured on the
 * demos, that guard has a price: once 20 % of a column is impossible, the rule
 * stops applying and the report says nothing at all. On titanic, 134 ages of
 * 999 are flagged; 178 are not.
 *
 * A contract freezes what was found on a reference file (its columns, their
 * types, how much is missing, which rules applied and how often they failed,
 * the shape of each distribution) and then requires it of the next file,
 * clause by clause.
 *
 * Two rules shape the reading.
 *
 * 1. A fact is not an estimate. A column that is gone, values that no longer
 *    read as numbers, a value that is impossible: the clause is broken, with
 *    no threshold. A share of missing values or a distribution is an
 *    estimate, and counts only beyond its noise (Newcombe's interval for a
 *    share, V62's ceiling for a PSI), at a level shared between the columns.
 *
 *    The first version held « a type that changed is a fact », and the
 *    measure refused it. The type the lab INFERS (categorical or text, number
 *    or identifier) rests on how many distinct values a file happens to hold:
 *    on two halves of one 118-row file it changed for one column in every two
 *    checks. What does not waver is how the values READ, as numbers, dates or
 *    words, and that is what the clause tests.
 * 2. Moving is not breaking. A distribution that drifted is a warning: the
 *    data changed without becoming invalid.
 *
 * The contract holds names, types, bounds, shares and counts. Never a row.
 * Checking is not cleaning: nothing here repairs what it finds.
 */
import { inferColumnType, isMissing, parseNumber } from '@/features/ml/data/infer';
import {
  applicableConsistency,
  applyConsistency,
  type ConsistencyRule,
} from '@/features/data/quality/consistency';
import {
  buildProfile,
  compareToProfile,
  parseProfile,
  PROFILE_FORMAT,
  type ColumnProfileEntry,
} from '@/features/data/quality/reference';
import {
  applicableRules,
  applyRule,
  boundOf,
  MAX_EXAMPLE_ROWS,
  type ValidityRule,
} from '@/features/data/quality/validity';
import type { Cell, ColumnType } from '@/features/ml/data/types';

export const CONTRACT_FORMAT = 'labml-data-contract/1';

const VALIDITY_RULES: readonly ValidityRule[] = [
  'ageRange',
  'futureDate',
  'percentRange',
  'negativeAmount',
  'postcodeShape',
];
const CONSISTENCY_RULES: readonly ConsistencyRule[] = ['dateOrder', 'productMismatch'];
const READINGS: readonly Reading[] = ['number', 'date', 'words', 'empty'];
const COLUMN_TYPES: readonly ColumnType[] = [
  'numeric',
  'categorical',
  'boolean',
  'date',
  'text',
  'id',
];

/** How a column's values read. Unlike the inferred type, it does not depend on their variety. */
export type Reading = 'number' | 'date' | 'words' | 'empty';

/** At least this share of the values must read one way for the column to. */
const READING_SHARE = 0.8;

export function readingOf(name: string, values: Cell[]): Reading {
  let present = 0;
  let numeric = 0;
  for (const value of values) {
    if (isMissing(value)) continue;
    present += 1;
    if (parseNumber((value as string).trim()) !== null) numeric += 1;
  }
  if (present === 0) return 'empty';
  if (numeric / present >= READING_SHARE) return 'number';
  return inferColumnType(name, values) === 'date' ? 'date' : 'words';
}

export interface ContractColumn {
  name: string;
  /** The type the lab inferred at the reference: shown, not required. */
  type: ColumnType;
  /** How the values read: required. */
  reading: Reading;
  missingRatio: number;
  /**
   * Bins and shares of the column, where a distribution means something: a
   * numeric, categorical or boolean column. An identifier, a date or free
   * text has none, since a fresh file's identifiers always « drift ».
   */
  profile?: ColumnProfileEntry;
}

export type ContractRule =
  | {
      kind: 'validity';
      rule: ValidityRule;
      columns: [string];
      bound?: { min?: number; max?: number };
      /** What the reference itself looked like under this rule. */
      failures: number;
      tested: number;
    }
  | {
      kind: 'consistency';
      rule: ConsistencyRule;
      columns: string[];
      failures: number;
      tested: number;
    };

export interface DataContract {
  format: typeof CONTRACT_FORMAT;
  source: string;
  createdAt: string;
  rowCount: number;
  columns: ContractColumn[];
  rules: ContractRule[];
}

const hasDistribution = (type: ColumnType) =>
  type === 'numeric' || type === 'categorical' || type === 'boolean';

function missingShare(values: Cell[]): number {
  if (values.length === 0) return 0;
  let missing = 0;
  for (const value of values) if (isMissing(value)) missing += 1;
  return missing / values.length;
}

/** Freezes what a reference file looks like. `now` pins « the future » for the date rule. */
export function buildContract(
  header: readonly string[],
  columns: Cell[][],
  source: string,
  now = new Date(),
): DataContract {
  const profile = buildProfile(header, columns, source, now);
  const profiles = new Map(profile.columns.map((entry) => [entry.column, entry]));

  const contractColumns: ContractColumn[] = header.map((name, i) => {
    const values = columns[i] ?? [];
    const type = inferColumnType(name, values);
    const entry = profiles.get(name);
    return {
      name,
      type,
      reading: readingOf(name, values),
      missingRatio: missingShare(values),
      ...(hasDistribution(type) && entry !== undefined && { profile: entry }),
    };
  });

  const rules: ContractRule[] = [];
  header.forEach((name, i) => {
    const values = columns[i] ?? [];
    for (const rule of applicableRules(name, values)) {
      const { failures, tested } = applyRule(rule, values, now.getTime());
      const bound = boundOf(rule);
      rules.push({
        kind: 'validity',
        rule,
        columns: [name],
        ...(bound !== undefined && { bound }),
        failures: failures.length,
        tested,
      });
    }
  });
  for (const { rule, columns: names } of applicableConsistency(header, columns)) {
    const cells = names.map((name) => columns[header.indexOf(name)] ?? []);
    const { failures, tested } = applyConsistency(rule, cells);
    rules.push({ kind: 'consistency', rule, columns: names, failures: failures.length, tested });
  }

  return {
    format: CONTRACT_FORMAT,
    source,
    createdAt: now.toISOString(),
    rowCount: columns[0]?.length ?? 0,
    columns: contractColumns,
    rules,
  };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isShare = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

function parseBound(raw: unknown): { min?: number; max?: number } | undefined {
  if (!isObject(raw)) return undefined;
  const bound: { min?: number; max?: number } = {};
  if (typeof raw.min === 'number' && Number.isFinite(raw.min)) bound.min = raw.min;
  if (typeof raw.max === 'number' && Number.isFinite(raw.max)) bound.max = raw.max;
  return bound;
}

/**
 * Reads an exported contract. Null for anything that is not one, whole: a
 * contract that cannot be trusted to state its clauses is refused, never
 * half-applied, since a clause silently dropped is a check silently skipped.
 */
export function parseContract(json: string): DataContract | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isObject(parsed) || parsed.format !== CONTRACT_FORMAT) return null;
  if (!Array.isArray(parsed.columns) || !Array.isArray(parsed.rules)) return null;
  if (!isCount(parsed.rowCount)) return null;

  const columns: ContractColumn[] = [];
  for (const raw of parsed.columns) {
    if (!isObject(raw) || typeof raw.name !== 'string') return null;
    if (!COLUMN_TYPES.includes(raw.type as ColumnType) || !isShare(raw.missingRatio)) return null;
    if (!READINGS.includes(raw.reading as Reading)) return null;
    const column: ContractColumn = {
      name: raw.name,
      type: raw.type as ColumnType,
      reading: raw.reading as Reading,
      missingRatio: raw.missingRatio,
    };
    if (raw.profile !== undefined) {
      // The profile reader already knows what a column entry must look like.
      const entry = parseProfile(JSON.stringify({ format: PROFILE_FORMAT, columns: [raw.profile] }))
        ?.columns[0];
      if (!entry || entry.column !== raw.name) return null;
      column.profile = entry;
    }
    columns.push(column);
  }
  if (columns.length === 0) return null;
  const names = new Set(columns.map((column) => column.name));

  const rules: ContractRule[] = [];
  for (const raw of parsed.rules) {
    if (!isObject(raw) || !Array.isArray(raw.columns)) return null;
    if (!raw.columns.every((name): name is string => typeof name === 'string' && names.has(name))) {
      return null;
    }
    if (!isCount(raw.failures) || !isCount(raw.tested) || raw.failures > raw.tested) return null;
    if (raw.kind === 'validity') {
      if (!VALIDITY_RULES.includes(raw.rule as ValidityRule) || raw.columns.length !== 1) {
        return null;
      }
      const bound = parseBound(raw.bound);
      rules.push({
        kind: 'validity',
        rule: raw.rule as ValidityRule,
        columns: [raw.columns[0]],
        ...(bound !== undefined && { bound }),
        failures: raw.failures,
        tested: raw.tested,
      });
    } else if (raw.kind === 'consistency') {
      const rule = raw.rule as ConsistencyRule;
      if (!CONSISTENCY_RULES.includes(rule)) return null;
      if (raw.columns.length !== (rule === 'dateOrder' ? 2 : 3)) return null;
      rules.push({
        kind: 'consistency',
        rule,
        columns: raw.columns,
        failures: raw.failures,
        tested: raw.tested,
      });
    } else {
      return null;
    }
  }

  return {
    format: CONTRACT_FORMAT,
    source: typeof parsed.source === 'string' ? parsed.source : '',
    createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : '',
    rowCount: parsed.rowCount,
    columns,
    rules,
  };
}

export type ClauseOutcome = 'kept' | 'warning' | 'broken';

export type Clause =
  | { family: 'schema'; kind: 'present'; column: string; outcome: 'kept' | 'broken' }
  | {
      family: 'schema';
      kind: 'reading';
      column: string;
      expected: Reading;
      found: Reading;
      outcome: 'kept' | 'broken';
    }
  | {
      family: 'missing';
      column: string;
      /** Share of missing values at the reference, and in this file. */
      reference: number;
      found: number;
      /** Interval of the difference, this file minus the reference. */
      lo: number;
      hi: number;
      outcome: 'kept' | 'broken';
    }
  | {
      family: 'rule';
      rule: ValidityRule | ConsistencyRule;
      columns: string[];
      bound?: { min?: number; max?: number };
      referenceFailures: number;
      referenceTested: number;
      failures: number;
      tested: number;
      /** First failing rows, 0-based, and what they hold. */
      rows: number[];
      examples: string[];
      /** True when the rule found nothing it could read in its columns. */
      unreadable?: true;
      outcome: ClauseOutcome;
    }
  | {
      family: 'distribution';
      column: string;
      psi: number;
      ceiling?: number;
      outcome: 'kept' | 'warning';
    };

export interface ContractCheck {
  /** The worst outcome among the clauses. */
  verdict: ClauseOutcome;
  rows: number;
  clauses: Clause[];
  counts: Record<ClauseOutcome, number>;
  /** Columns the file has that the contract does not describe: noted, not broken. */
  extraColumns: string[];
}

/** Chance, on a file that did not change, that one check breaks a clause that is an estimate. */
export const FALSE_BREAK_RATE = 0.05;

/** Standard normal quantile (Acklam's rational approximation, error under 1e-9 here). */
function normalQuantile(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269];
  const a2 = [-30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972];
  const b2 = -13.28068155288572;
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734];
  const c2 = [4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c2[0]) * q + c2[1]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p > 1 - low) return -normalQuantile(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a2[0]) * r + a2[1]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b2) * r + 1)
  );
}

function wilson(share: number, n: number, z: number): { lo: number; hi: number } {
  if (!(n > 0)) return { lo: 0, hi: 1 };
  const denominator = 1 + (z * z) / n;
  const centre = (share + (z * z) / (2 * n)) / denominator;
  const margin = (z * Math.sqrt((share * (1 - share)) / n + (z * z) / (4 * n * n))) / denominator;
  return { lo: Math.max(0, centre - margin), hi: Math.min(1, centre + margin) };
}

/** Newcombe's interval for the difference of two shares, `a` minus `b`, at the given z. */
function shareDifference(
  a: number,
  n: number,
  b: number,
  m: number,
  z: number,
): { lo: number; hi: number } {
  const wa = wilson(a, n, z);
  const wb = wilson(b, m, z);
  const delta = a - b;
  return {
    lo: delta - Math.hypot(a - wa.lo, wb.hi - b),
    hi: delta + Math.hypot(wa.hi - a, b - wb.lo),
  };
}

const RANK: Record<ClauseOutcome, number> = { kept: 0, warning: 1, broken: 2 };

/**
 * Reads one file against a contract, clause by clause. Every clause of the
 * contract yields exactly one answer; none is dropped because the file is too
 * damaged for it.
 */
export function checkContract(
  contract: DataContract,
  header: readonly string[],
  columns: Cell[][],
  now = Date.now(),
): ContractCheck {
  const index = new Map(header.map((name, i) => [name, i]));
  const rows = columns[0]?.length ?? 0;
  const clauses: Clause[] = [];
  const cellsOf = (name: string): Cell[] | null => {
    const at = index.get(name);
    return at === undefined ? null : (columns[at] ?? []);
  };

  // 1. Schema: facts.
  for (const column of contract.columns) {
    const values = cellsOf(column.name);
    clauses.push({
      family: 'schema',
      kind: 'present',
      column: column.name,
      outcome: values === null ? 'broken' : 'kept',
    });
    if (values === null) continue;
    const found = readingOf(column.name, values);
    // An empty column says nothing of how it reads: the missing clause speaks for it.
    const comparable = found !== 'empty' && column.reading !== 'empty';
    clauses.push({
      family: 'schema',
      kind: 'reading',
      column: column.name,
      expected: column.reading,
      found,
      outcome: comparable && found !== column.reading ? 'broken' : 'kept',
    });
  }

  // The estimates of one check share one level: a clause is tested on one side
  // (more missing, more failures), and there are as many as columns and rules
  // that already failed at the reference.
  const estimates =
    contract.columns.filter((column) => index.has(column.name)).length +
    contract.rules.filter((rule) => rule.failures > 0).length;
  const z = normalQuantile(1 - FALSE_BREAK_RATE / Math.max(1, estimates));

  // 2. Missing values: an estimate, broken only by a share measurably higher.
  for (const column of contract.columns) {
    const values = cellsOf(column.name);
    if (values === null || rows === 0 || contract.rowCount === 0) continue;
    const found = missingShare(values);
    const { lo, hi } = shareDifference(found, rows, column.missingRatio, contract.rowCount, z);
    clauses.push({
      family: 'missing',
      column: column.name,
      reference: column.missingRatio,
      found,
      lo,
      hi,
      outcome: lo > 0 ? 'broken' : 'kept',
    });
  }

  // 3. Rules: facts, applied without the guard that silences them.
  for (const rule of contract.rules) {
    const cells = rule.columns.map(cellsOf);
    if (cells.some((values) => values === null)) continue; // the schema clause already says so
    const present = cells as Cell[][];
    const result =
      rule.kind === 'validity'
        ? applyRule(rule.rule, present[0], now)
        : applyConsistency(rule.rule, present);
    const failures = result.failures;
    const examples = failures
      .slice(0, MAX_EXAMPLE_ROWS)
      .map((failure) => ('value' in failure ? failure.value : failure.example));
    let outcome: ClauseOutcome;
    if (result.tested === 0) {
      // Nothing the rule could read: not a pass, and not a proven failure.
      outcome = 'warning';
    } else if (rule.failures === 0) {
      // Clean at the reference: the first impossible value breaks it.
      outcome = failures.length > 0 ? 'broken' : 'kept';
    } else {
      // Already failing at the reference: broken by a share measurably higher.
      const { lo } = shareDifference(
        failures.length / result.tested,
        result.tested,
        rule.failures / rule.tested,
        rule.tested,
        z,
      );
      outcome = lo > 0 ? 'broken' : 'kept';
    }
    clauses.push({
      family: 'rule',
      rule: rule.rule,
      columns: rule.columns,
      ...(rule.kind === 'validity' && rule.bound !== undefined && { bound: rule.bound }),
      referenceFailures: rule.failures,
      referenceTested: rule.tested,
      failures: failures.length,
      tested: result.tested,
      rows: failures.slice(0, MAX_EXAMPLE_ROWS).map((failure) => failure.row),
      examples,
      ...(result.tested === 0 && { unreadable: true as const }),
      outcome,
    });
  }

  // 4. Distributions: estimates, read against their noise ceiling. A warning.
  const entries = contract.columns
    .filter((column) => column.profile !== undefined && index.has(column.name))
    .map((column) => column.profile!);
  if (entries.length > 0 && rows > 0) {
    const comparison = compareToProfile(
      {
        format: PROFILE_FORMAT,
        source: contract.source,
        createdAt: contract.createdAt,
        rowCount: contract.rowCount,
        columns: entries,
      },
      header,
      columns,
    );
    for (const drift of comparison.columns) {
      clauses.push({
        family: 'distribution',
        column: drift.column,
        psi: drift.psi,
        ...(drift.ceiling !== undefined && { ceiling: drift.ceiling }),
        outcome: drift.severity === 'stable' ? 'kept' : 'warning',
      });
    }
  }

  const counts: Record<ClauseOutcome, number> = { kept: 0, warning: 0, broken: 0 };
  let verdict: ClauseOutcome = 'kept';
  for (const clause of clauses) {
    counts[clause.outcome] += 1;
    if (RANK[clause.outcome] > RANK[verdict]) verdict = clause.outcome;
  }
  const described = new Set(contract.columns.map((column) => column.name));
  return {
    verdict,
    rows,
    clauses,
    counts,
    extraColumns: header.filter((name) => !described.has(name)),
  };
}

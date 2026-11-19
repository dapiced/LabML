import { isMissing, parseNumber } from '@/features/ml/data/infer';
import type {
  Cell,
  ColumnProfile,
  ColumnRedundancy,
  ColumnSuggestion,
  TargetAnalysis,
  TaskInfo,
} from '@/features/ml/data/types';

/** Share of missing values above which a column is suggested for exclusion. */
const NEAR_EMPTY_RATIO = 0.95;
/** Maximum distinct integer values for a numeric target to count as classification. */
const NUMERIC_CLASS_LIMIT = 10;
/** Maximum classes supported for a classification target. */
const MAX_CLASSES = 20;
/** |Pearson r| above which a numeric column is flagged as leaking a numeric target. */
const LEAK_CORRELATION = 0.995;

/** Target-independent exclusion suggestions: identifiers, constants, near-empty columns. */
export function baselineSuggestions(profiles: ColumnProfile[]): ColumnSuggestion[] {
  const suggestions: ColumnSuggestion[] = [];
  for (const profile of profiles) {
    if (profile.type === 'id') {
      suggestions.push({ column: profile.name, reason: 'id' });
    } else if (
      profile.rowCount > 0 &&
      profile.missingCount / profile.rowCount >= NEAR_EMPTY_RATIO
    ) {
      suggestions.push({ column: profile.name, reason: 'nearEmpty' });
    } else if (profile.cardinality <= 1) {
      suggestions.push({ column: profile.name, reason: 'constant' });
    }
  }
  return suggestions;
}

function distinctNonMissing(values: Cell[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (isMissing(value)) continue;
    const trimmed = (value as string).trim();
    counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
  }
  return counts;
}

export function detectTask(profile: ColumnProfile, values: Cell[]): TaskInfo | null {
  if (profile.type === 'boolean' || profile.type === 'categorical') {
    if (profile.cardinality < 2 || profile.cardinality > MAX_CLASSES) return null;
    const classes = [...distinctNonMissing(values).keys()].sort();
    return { type: classes.length === 2 ? 'binary' : 'multiclass', classes };
  }
  if (profile.type === 'numeric') {
    const distinct = distinctNonMissing(values);
    const numbers = [...distinct.keys()].map((v) => parseNumber(v));
    const allIntegers = numbers.every((n) => n !== null && Number.isInteger(n));
    if (distinct.size >= 2 && distinct.size <= NUMERIC_CLASS_LIMIT && allIntegers) {
      const classes = [...distinct.keys()].sort((a, b) => Number(a) - Number(b));
      return { type: classes.length === 2 ? 'binary' : 'multiclass', classes };
    }
    return { type: 'regression' };
  }
  return null;
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  const meanX = xs.reduce((a, v) => a + v, 0) / n;
  const meanY = ys.reduce((a, v) => a + v, 0) / n;
  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  if (varX === 0 || varY === 0) return 0;
  return cov / Math.sqrt(varX * varY);
}

/**
 * Flags columns that (almost) determine the target — the "alive vs survived" case.
 * Classification: every value of the column maps to a single target class, with a
 * cardinality guard so unique-ish columns do not trivially qualify.
 * Regression: |Pearson r| above LEAK_CORRELATION.
 */
export function leakSuggestions(
  target: string,
  task: TaskInfo,
  columns: Map<string, Cell[]>,
  profiles: ColumnProfile[],
): ColumnSuggestion[] {
  const targetValues = columns.get(target);
  if (!targetValues) return [];
  const suggestions: ColumnSuggestion[] = [];

  for (const profile of profiles) {
    if (profile.name === target) continue;
    const values = columns.get(profile.name);
    if (!values) continue;

    if (task.type === 'regression') {
      if (profile.type !== 'numeric') continue;
      const xs: number[] = [];
      const ys: number[] = [];
      for (let i = 0; i < values.length; i++) {
        if (isMissing(values[i]) || isMissing(targetValues[i])) continue;
        const x = parseNumber(values[i] as string);
        const y = parseNumber(targetValues[i] as string);
        if (x === null || y === null) continue;
        xs.push(x);
        ys.push(y);
      }
      if (xs.length >= 3 && Math.abs(pearson(xs, ys)) >= LEAK_CORRELATION) {
        suggestions.push({ column: profile.name, reason: 'leak' });
      }
      continue;
    }

    // Classification: functional-dependency purity with a cardinality guard —
    // high-cardinality columns are pure almost by construction, so they are skipped.
    if (profile.cardinality < 2 || profile.cardinality > profile.rowCount * 0.2) continue;
    const mapping = new Map<string, string>();
    let pure = true;
    let checked = 0;
    for (let i = 0; i < values.length; i++) {
      if (isMissing(values[i]) || isMissing(targetValues[i])) continue;
      const key = (values[i] as string).trim();
      const label = (targetValues[i] as string).trim();
      const known = mapping.get(key);
      if (known === undefined) {
        mapping.set(key, label);
      } else if (known !== label) {
        pure = false;
        break;
      }
      checked += 1;
    }
    if (pure && checked > 0) {
      suggestions.push({ column: profile.name, reason: 'leak' });
    }
  }
  return suggestions;
}

/** A column counts as discrete, for the twin test, up to this many distinct values. */
export const REDUNDANCY_MAX_VALUES = 50;
/** And only when a value is seen this many times on average: fewer, and purity is luck. */
export const REDUNDANCY_ROWS_PER_VALUE = 5;
/** Rows where both columns hold a value, below which a pair is not judged. */
export const REDUNDANCY_MIN_ROWS = 30;
/** Rows read per pair: enough to judge, and a wide file stays quick to open. */
export const REDUNDANCY_SAMPLE = 20_000;

/** Columns compared at most, discrete ones first: the pairs grow as the square. */
export const REDUNDANCY_MAX_COLUMNS = 80;

/**
 * Does every value of `from` go with one single value of `to`? Both columns
 * are given as codes (-1 for a missing cell), read once per column, so a pair
 * costs one pass over two integer arrays.
 */
function determines(from: Int32Array, to: Int32Array, fromValues: number): boolean {
  const mapping = new Int32Array(fromValues).fill(-1);
  for (let i = 0; i < from.length; i++) {
    const key = from[i];
    const value = to[i];
    if (key < 0 || value < 0) continue;
    if (mapping[key] === -1) mapping[key] = value;
    else if (mapping[key] !== value) return false;
  }
  return true;
}

/**
 * V70: pairs of columns that say the same thing, the class/pclass case. The
 * functional-dependency test `leakSuggestions` runs from a column to the
 * target, run here between columns, and for two continuous numbers the same
 * near-perfect correlation.
 *
 * Target-independent, so it is computed when the file is read. It flags and
 * excludes nothing: twins split the importance between them and let a
 * counterfactual change one without the other (V68), but which one to keep is
 * the user's call.
 *
 * Measured before the panel (PLAN.md, V70): on titanic it finds pclass/class,
 * embarked/embark_town, adult_male from who, and the alive/survived leak, and
 * nothing on the nine other demo files. Removing the twins moves no score
 * (0.813 against 0.814 of mean accuracy over ten seeds): this is about reading
 * a model, not about its performance.
 */
export function redundancySuggestions(
  columns: Map<string, Cell[]>,
  profiles: ColumnProfile[],
): ColumnRedundancy[] {
  const isDiscrete = (profile: ColumnProfile) =>
    profile.cardinality <= REDUNDANCY_MAX_VALUES &&
    profile.cardinality * REDUNDANCY_ROWS_PER_VALUE <= profile.rowCount - profile.missingCount;
  const usable = profiles
    .filter(
      (profile) =>
        profile.cardinality >= 2 &&
        profile.type !== 'id' &&
        profile.type !== 'text' &&
        profile.type !== 'date' &&
        columns.has(profile.name) &&
        (isDiscrete(profile) || profile.type === 'numeric'),
    )
    .slice(0, REDUNDANCY_MAX_COLUMNS);

  // Each column is read once: codes for a discrete one, numbers for the others.
  const rows = columns.get(usable[0]?.name ?? '')?.length ?? 0;
  const step = Math.max(1, Math.ceil(rows / REDUNDANCY_SAMPLE));
  const read = usable.map((profile) => {
    const cells = columns.get(profile.name)!;
    const size = Math.ceil(rows / step);
    if (isDiscrete(profile)) {
      const codes = new Int32Array(size).fill(-1);
      const known = new Map<string, number>();
      for (let i = 0, at = 0; i < rows; i += step, at++) {
        if (isMissing(cells[i])) continue;
        const text = (cells[i] as string).trim();
        let code = known.get(text);
        if (code === undefined) {
          code = known.size;
          known.set(text, code);
        }
        codes[at] = code;
      }
      return { name: profile.name, codes, values: known.size, numbers: null };
    }
    const numbers = new Float64Array(size).fill(Number.NaN);
    for (let i = 0, at = 0; i < rows; i += step, at++) {
      if (isMissing(cells[i])) continue;
      const value = parseNumber(cells[i] as string);
      if (value !== null) numbers[at] = value;
    }
    return { name: profile.name, codes: null, values: 0, numbers };
  });

  const found: ColumnRedundancy[] = [];
  for (let a = 0; a < read.length; a++) {
    for (let b = a + 1; b < read.length; b++) {
      const first = read[a];
      const second = read[b];

      if (first.codes && second.codes) {
        let shared = 0;
        const seenLeft = new Set<number>();
        const seenRight = new Set<number>();
        for (let i = 0; i < first.codes.length; i++) {
          if (first.codes[i] < 0 || second.codes[i] < 0) continue;
          shared += 1;
          seenLeft.add(first.codes[i]);
          seenRight.add(second.codes[i]);
        }
        // A column that is constant on the shared rows is determined by anything.
        if (shared < REDUNDANCY_MIN_ROWS || seenLeft.size < 2 || seenRight.size < 2) continue;
        const forward = determines(first.codes, second.codes, first.values);
        const backward = determines(second.codes, first.codes, second.values);
        if (forward && backward) {
          found.push({ column: first.name, of: second.name, relation: 'same' });
          found.push({ column: second.name, of: first.name, relation: 'same' });
        } else if (forward) {
          found.push({ column: second.name, of: first.name, relation: 'determined' });
        } else if (backward) {
          found.push({ column: first.name, of: second.name, relation: 'determined' });
        }
        continue;
      }

      if (first.numbers && second.numbers) {
        const xs: number[] = [];
        const ys: number[] = [];
        for (let i = 0; i < first.numbers.length; i++) {
          const x = first.numbers[i];
          const y = second.numbers[i];
          if (Number.isNaN(x) || Number.isNaN(y)) continue;
          xs.push(x);
          ys.push(y);
        }
        if (xs.length >= REDUNDANCY_MIN_ROWS && Math.abs(pearson(xs, ys)) >= LEAK_CORRELATION) {
          found.push({ column: first.name, of: second.name, relation: 'same' });
          found.push({ column: second.name, of: first.name, relation: 'same' });
        }
      }
    }
  }
  return found;
}

export function analyzeTarget(
  target: string,
  columns: Map<string, Cell[]>,
  profiles: ColumnProfile[],
): TargetAnalysis {
  const profile = profiles.find((p) => p.name === target);
  const values = columns.get(target);
  if (!profile || !values || profile.cardinality === 0) {
    return { task: null, unsupportedReason: 'empty', suggestions: [] };
  }
  if (profile.type === 'date' || profile.type === 'text' || profile.type === 'id') {
    return { task: null, unsupportedReason: 'type', suggestions: [] };
  }
  const task = detectTask(profile, values);
  if (!task) {
    return { task: null, unsupportedReason: 'tooManyClasses', suggestions: [] };
  }
  return { task, suggestions: leakSuggestions(target, task, columns, profiles) };
}

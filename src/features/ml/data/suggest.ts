import { isMissing, parseNumber } from '@/features/ml/data/infer';
import type {
  Cell,
  ColumnProfile,
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

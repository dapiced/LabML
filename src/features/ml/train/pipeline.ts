import { isMissing, parseNumber } from '@/features/ml/data/infer';
import { mulberry32, shuffleInPlace } from '@/features/ml/train/random';
import type { Cell, ColumnProfile } from '@/features/ml/data/types';

/** Categorical columns with at most this many categories are one-hot encoded. */
const ONE_HOT_MAX = 12;

type FeatureSpec =
  | { kind: 'numeric'; name: string; median: number; mean: number; std: number }
  | { kind: 'onehot'; name: string; categories: string[]; mode: string }
  | {
      kind: 'ordinal';
      name: string;
      /** Category → frequency rank (0 = most frequent on the train split). */
      ranks: Map<string, number>;
      mode: string;
      mean: number;
      std: number;
    };

export interface FittedPipeline {
  specs: FeatureSpec[];
  featureNames: string[];
  transform(indices: number[]): number[][];
}

function cellString(value: Cell): string | null {
  return isMissing(value) ? null : (value as string).trim();
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function meanStd(values: number[]): { mean: number; std: number } {
  if (values.length === 0) return { mean: 0, std: 1 };
  const mean = values.reduce((a, v) => a + v, 0) / values.length;
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length;
  return { mean, std: Math.sqrt(variance) || 1 };
}

/**
 * Fits imputation/encoding/standardization parameters on the TRAIN indices only,
 * then transforms any subset of rows — the classic no-leakage contract.
 */
export function fitPipeline(
  columns: Map<string, Cell[]>,
  profiles: ColumnProfile[],
  featureColumns: string[],
  trainIndices: number[],
): FittedPipeline {
  const specs: FeatureSpec[] = [];

  for (const name of featureColumns) {
    const profile = profiles.find((p) => p.name === name);
    const values = columns.get(name);
    if (!profile || !values) continue;

    if (profile.type === 'numeric') {
      const trainNumbers: number[] = [];
      for (const i of trainIndices) {
        const raw = cellString(values[i]);
        if (raw === null) continue;
        const parsed = parseNumber(raw);
        if (parsed !== null) trainNumbers.push(parsed);
      }
      const sorted = [...trainNumbers].sort((a, b) => a - b);
      const { mean, std } = meanStd(trainNumbers);
      specs.push({ kind: 'numeric', name, median: median(sorted), mean, std });
      continue;
    }

    // categorical / boolean
    const counts = new Map<string, number>();
    for (const i of trainIndices) {
      const raw = cellString(values[i]);
      if (raw === null) continue;
      counts.set(raw, (counts.get(raw) ?? 0) + 1);
    }
    const byFrequency = [...counts.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
    const mode = byFrequency[0]?.[0] ?? '';
    if (byFrequency.length <= ONE_HOT_MAX) {
      specs.push({ kind: 'onehot', name, categories: byFrequency.map(([v]) => v), mode });
    } else {
      const ranks = new Map(byFrequency.map(([v], rank) => [v, rank]));
      const trainRanks: number[] = [];
      for (const i of trainIndices) {
        const raw = cellString(values[i]);
        trainRanks.push(ranks.get(raw ?? mode) ?? ranks.get(mode) ?? 0);
      }
      const { mean, std } = meanStd(trainRanks);
      specs.push({ kind: 'ordinal', name, ranks, mode, mean, std });
    }
  }

  const featureNames = specs.flatMap((spec) =>
    spec.kind === 'onehot' ? spec.categories.map((c) => `${spec.name}=${c}`) : [spec.name],
  );

  function transform(indices: number[]): number[][] {
    return indices.map((i) => {
      const row: number[] = [];
      for (const spec of specs) {
        const raw = cellString(columns.get(spec.name)![i]);
        if (spec.kind === 'numeric') {
          const parsed = raw === null ? null : parseNumber(raw);
          const value = parsed === null ? spec.median : parsed;
          row.push((value - spec.mean) / spec.std);
        } else if (spec.kind === 'onehot') {
          const value = raw ?? spec.mode;
          for (const category of spec.categories) row.push(value === category ? 1 : 0);
        } else {
          const rank = spec.ranks.get(raw ?? spec.mode) ?? spec.ranks.get(spec.mode) ?? 0;
          row.push((rank - spec.mean) / spec.std);
        }
      }
      return row;
    });
  }

  return { specs, featureNames, transform };
}

/** Rows with a usable (non-missing) target value. */
export function usableRows(targetValues: Cell[]): number[] {
  const rows: number[] = [];
  for (let i = 0; i < targetValues.length; i++) {
    if (!isMissing(targetValues[i])) rows.push(i);
  }
  return rows;
}

/**
 * Seeded 80/20 split. Classification splits are stratified per class so both
 * sides keep the class balance; regression uses a plain shuffled split.
 */
export function splitIndices(
  rows: number[],
  labels: (string | null)[] | null,
  testRatio: number,
  seed: number,
): { train: number[]; test: number[] } {
  const rng = mulberry32(seed);
  const train: number[] = [];
  const test: number[] = [];

  if (labels === null) {
    const shuffled = shuffleInPlace([...rows], rng);
    const testCount = Math.max(1, Math.round(shuffled.length * testRatio));
    test.push(...shuffled.slice(0, testCount));
    train.push(...shuffled.slice(testCount));
  } else {
    const byClass = new Map<string, number[]>();
    rows.forEach((row, position) => {
      const label = labels[position] ?? '';
      const bucket = byClass.get(label);
      if (bucket) bucket.push(row);
      else byClass.set(label, [row]);
    });
    for (const bucket of [...byClass.keys()].sort().map((k) => byClass.get(k)!)) {
      shuffleInPlace(bucket, rng);
      const testCount = Math.max(1, Math.round(bucket.length * testRatio));
      test.push(...bucket.slice(0, testCount));
      train.push(...bucket.slice(testCount));
    }
  }

  train.sort((a, b) => a - b);
  test.sort((a, b) => a - b);
  return { train, test };
}

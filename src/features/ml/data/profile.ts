import { inferColumnType, isMissing, parseNumber } from '@/features/ml/data/infer';
import type { Cell, ColumnProfile, NumericStats } from '@/features/ml/data/types';

const HISTOGRAM_BINS = 12;
const TOP_VALUES = 8;

export function computeNumericStats(numbers: number[]): NumericStats | undefined {
  if (numbers.length === 0) return undefined;
  const sorted = [...numbers].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const mean = numbers.reduce((acc, v) => acc + v, 0) / numbers.length;
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const variance = numbers.reduce((acc, v) => acc + (v - mean) ** 2, 0) / numbers.length;
  const std = Math.sqrt(variance);

  const counts = new Array<number>(min === max ? 1 : HISTOGRAM_BINS).fill(0);
  if (min === max) {
    counts[0] = numbers.length;
  } else {
    const width = (max - min) / HISTOGRAM_BINS;
    for (const value of numbers) {
      const bin = Math.min(Math.floor((value - min) / width), HISTOGRAM_BINS - 1);
      counts[bin] += 1;
    }
  }
  return { min, max, mean, median, std, histogram: { counts, min, max } };
}

export function profileColumn(name: string, values: Cell[]): ColumnProfile {
  const type = inferColumnType(name, values);
  const rowCount = values.length;

  let missingCount = 0;
  const counts = new Map<string, number>();
  const numbers: number[] = [];

  for (const value of values) {
    if (isMissing(value)) {
      missingCount += 1;
      continue;
    }
    const trimmed = (value as string).trim();
    counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
    if (type === 'numeric') {
      const parsed = parseNumber(trimmed);
      if (parsed !== null) numbers.push(parsed);
    }
  }

  const topValues = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TOP_VALUES)
    .map(([value, count]) => ({ value, count }));

  return {
    name,
    type,
    rowCount,
    missingCount,
    cardinality: counts.size,
    numeric: type === 'numeric' ? computeNumericStats(numbers) : undefined,
    topValues: type === 'numeric' ? undefined : topValues,
  };
}

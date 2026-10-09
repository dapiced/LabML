/**
 * V51 — the three helpers drift detection (V17) and the reference profile
 * (V40) both need, which each file used to carry a copy of. The copies were
 * identical; keeping one means a fix to how a number is read, or how a
 * missing cell is counted, reaches both features at once.
 */
import { isMissing, parseNumber } from '@/features/ml/data/infer';
import type { Cell } from '@/features/ml/data/types';

/** Every cell that reads as a number, in order; missing and non-numeric cells skipped. */
export function numbersOf(values: Cell[]): number[] {
  const numbers: number[] = [];
  for (const value of values) {
    if (isMissing(value)) continue;
    const parsed = parseNumber((value as string).trim());
    if (parsed !== null) numbers.push(parsed);
  }
  return numbers;
}

/** Share of missing cells; 0 for an empty column. */
export function missingRatio(values: Cell[]): number {
  if (values.length === 0) return 0;
  let missing = 0;
  for (const value of values) if (isMissing(value)) missing += 1;
  return missing / values.length;
}

/** Shares over bins whose edges are given (open-ended tails); all zero for no numbers. */
export function sharesOverEdges(edges: number[], numbers: number[]): number[] {
  const counts = new Array<number>(edges.length + 1).fill(0);
  for (const value of numbers) {
    let bin = 0;
    while (bin < edges.length && value > edges[bin]) bin += 1;
    counts[bin] += 1;
  }
  return counts.map((count) => (numbers.length > 0 ? count / numbers.length : 0));
}

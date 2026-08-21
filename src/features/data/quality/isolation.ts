/**
 * Hand-written Isolation Forest — multivariate anomaly detection that sees
 * what univariate Tukey fences miss: rows whose COMBINATION of values is odd.
 * Anomalous rows are isolated by fewer random splits, so their average path
 * length through random trees is short. Fully seeded and deterministic:
 * same data, same seed — same scores, always.
 */
import { inferColumnType, isMissing, parseNumber } from '@/features/ml/data/infer';
import { mulberry32 } from '@/features/ml/train/random';
import type { Cell } from '@/features/ml/data/types';

const TREES = 100;
const SUBSAMPLE = 256;
const SEED = 42;
/** Conventional cut: scores above this are anomalies (0.5 ≈ ordinary). */
export const ANOMALY_THRESHOLD = 0.6;
const MIN_ROWS = 16;
const EULER_MASCHERONI = 0.5772156649015329;

type Tree =
  | { kind: 'leaf'; size: number }
  | { kind: 'split'; feature: number; value: number; below: Tree; above: Tree };

/** Average unsuccessful-search path length in a BST of n nodes. */
function c(n: number): number {
  if (n <= 1) return 0;
  return 2 * (Math.log(n - 1) + EULER_MASCHERONI) - (2 * (n - 1)) / n;
}

function buildTree(
  X: number[][],
  indices: number[],
  depth: number,
  maxDepth: number,
  rng: () => number,
): Tree {
  if (indices.length <= 1 || depth >= maxDepth) return { kind: 'leaf', size: indices.length };
  const featureCount = X[0].length;

  // Pick a random feature that still varies in this node (up to a few tries).
  let feature = -1;
  let min = 0;
  let max = 0;
  for (let attempt = 0; attempt < featureCount; attempt++) {
    const candidate = Math.floor(rng() * featureCount);
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const i of indices) {
      const v = X[i][candidate];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (hi > lo) {
      feature = candidate;
      min = lo;
      max = hi;
      break;
    }
  }
  if (feature < 0) return { kind: 'leaf', size: indices.length };

  const value = min + rng() * (max - min);
  const below: number[] = [];
  const above: number[] = [];
  for (const i of indices) {
    if (X[i][feature] < value) below.push(i);
    else above.push(i);
  }
  if (below.length === 0 || above.length === 0) return { kind: 'leaf', size: indices.length };
  return {
    kind: 'split',
    feature,
    value,
    below: buildTree(X, below, depth + 1, maxDepth, rng),
    above: buildTree(X, above, depth + 1, maxDepth, rng),
  };
}

function pathLength(tree: Tree, row: number[], depth: number): number {
  if (tree.kind === 'leaf') return depth + c(tree.size);
  return pathLength(row[tree.feature] < tree.value ? tree.below : tree.above, row, depth + 1);
}

export interface AnomalyScores {
  /** One score per row, in [0, 1] — higher is more anomalous. */
  scores: number[];
  featureColumns: string[];
}

/**
 * Scores every row, or returns null when the data cannot support it
 * (fewer than 2 numeric columns, or fewer than MIN_ROWS rows).
 * Missing numeric cells are read as the column median for scoring.
 */
export function isolationScores(
  header: string[],
  columns: Cell[][],
  seed = SEED,
): AnomalyScores | null {
  const rows = columns[0]?.length ?? 0;
  if (rows < MIN_ROWS) return null;

  const featureColumns: string[] = [];
  const features: number[][] = [];
  for (let i = 0; i < header.length; i++) {
    if (inferColumnType(header[i], columns[i]) !== 'numeric') continue;
    const parsed: (number | null)[] = columns[i].map((cell) =>
      isMissing(cell) ? null : parseNumber((cell as string).trim()),
    );
    const present = parsed.filter((v): v is number => v !== null).sort((a, b) => a - b);
    if (present.length === 0) continue;
    const median =
      present.length % 2 === 1
        ? present[(present.length - 1) / 2]
        : (present[present.length / 2 - 1] + present[present.length / 2]) / 2;
    featureColumns.push(header[i]);
    features.push(parsed.map((v) => v ?? median));
  }
  if (featureColumns.length < 2) return null;

  const X: number[][] = [];
  for (let r = 0; r < rows; r++) X.push(features.map((column) => column[r]));

  const rng = mulberry32(seed);
  const sample = Math.min(SUBSAMPLE, rows);
  const maxDepth = Math.ceil(Math.log2(sample));
  const expected = c(sample);
  const totals = new Array<number>(rows).fill(0);
  for (let tree = 0; tree < TREES; tree++) {
    // Seeded sample without replacement (partial Fisher-Yates).
    const pool = Array.from({ length: rows }, (_, i) => i);
    for (let i = 0; i < sample; i++) {
      const j = i + Math.floor(rng() * (rows - i));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const built = buildTree(X, pool.slice(0, sample), 0, maxDepth, rng);
    for (let r = 0; r < rows; r++) totals[r] += pathLength(built, X[r], 0);
  }

  return {
    scores: totals.map((total) => 2 ** (-(total / TREES) / expected)),
    featureColumns,
  };
}

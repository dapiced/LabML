/**
 * "Explore without a target": clusters the encoded features (k chosen by
 * silhouette), projects them with PCA for the scatter, and describes each
 * group by its most distinctive traits — all deterministic, all in the worker.
 */
import { isMissing, parseNumber } from '@/features/ml/data/infer';
import { fitPipeline } from '@/features/ml/train/pipeline';
import { mulberry32, shuffleInPlace } from '@/features/ml/train/random';
import { chooseKmeans } from '@/features/ml/unsupervised/kmeans';
import { pca2 } from '@/features/ml/unsupervised/pca';
import type { Cell, ColumnProfile } from '@/features/ml/data/types';

/** Rows used for clustering beyond this size are a seeded sample. */
const MAX_ROWS = 2000;
/** Points returned for the scatter (seeded sample of the clustered rows). */
const MAX_POINTS = 600;
const TRAITS_PER_CLUSTER = 3;
const TRAINABLE_TYPES = new Set(['numeric', 'categorical', 'boolean']);

export type ClusterTrait =
  | { kind: 'numeric'; column: string; clusterMean: number; overallMean: number }
  | { kind: 'categorical'; column: string; value: string; share: number; overallShare: number };

export interface ClusterSummary {
  id: number;
  size: number;
  /** size / rows clustered. */
  share: number;
  traits: ClusterTrait[];
}

export interface ExplorationPayload {
  k: number;
  silhouette: number;
  tried: { k: number; silhouette: number }[];
  /** PCA scatter sample: [x, y, cluster]. */
  points: [number, number, number][];
  explained: [number, number];
  clusters: ClusterSummary[];
  featureColumns: string[];
  rowsUsed: number;
  seed: number;
}

interface TraitCandidate {
  trait: ClusterTrait;
  weight: number;
}

function numericTraits(
  values: Cell[],
  rows: number[],
  members: number[][],
  column: string,
): TraitCandidate[][] {
  const parse = (i: number): number | null => {
    const cell = values[i];
    if (isMissing(cell)) return null;
    return parseNumber((cell as string).trim());
  };
  const all: number[] = [];
  for (const i of rows) {
    const v = parse(i);
    if (v !== null) all.push(v);
  }
  if (all.length < 2) return members.map(() => []);
  const overallMean = all.reduce((a, v) => a + v, 0) / all.length;
  const std = Math.sqrt(all.reduce((a, v) => a + (v - overallMean) ** 2, 0) / all.length) || 1;

  return members.map((member) => {
    const inCluster: number[] = [];
    for (const i of member) {
      const v = parse(i);
      if (v !== null) inCluster.push(v);
    }
    if (inCluster.length === 0) return [];
    const clusterMean = inCluster.reduce((a, v) => a + v, 0) / inCluster.length;
    return [
      {
        trait: { kind: 'numeric' as const, column, clusterMean, overallMean },
        weight: Math.abs(clusterMean - overallMean) / std,
      },
    ];
  });
}

function categoricalTraits(
  values: Cell[],
  rows: number[],
  members: number[][],
  column: string,
): TraitCandidate[][] {
  const countsOf = (indices: number[]): { counts: Map<string, number>; total: number } => {
    const counts = new Map<string, number>();
    let total = 0;
    for (const i of indices) {
      const cell = values[i];
      if (isMissing(cell)) continue;
      const key = (cell as string).trim();
      counts.set(key, (counts.get(key) ?? 0) + 1);
      total += 1;
    }
    return { counts, total };
  };
  const overall = countsOf(rows);
  if (overall.total === 0) return members.map(() => []);

  return members.map((member) => {
    const local = countsOf(member);
    if (local.total === 0) return [];
    let best: TraitCandidate | null = null;
    for (const [value, count] of local.counts) {
      const share = count / local.total;
      const overallShare = (overall.counts.get(value) ?? 0) / overall.total;
      const weight = Math.abs(share - overallShare);
      if (best === null || weight > best.weight) {
        best = {
          trait: { kind: 'categorical', column, value, share, overallShare },
          weight,
        };
      }
    }
    return best ? [best] : [];
  });
}

export function runExploration(
  columns: Map<string, Cell[]>,
  profiles: ColumnProfile[],
  features: string[],
  seed: number,
): ExplorationPayload {
  const featureColumns = features.filter((name) => {
    const profile = profiles.find((p) => p.name === name);
    return profile !== undefined && TRAINABLE_TYPES.has(profile.type);
  });
  if (featureColumns.length === 0) throw new Error('no-features');

  const rowCount = columns.get(featureColumns[0])?.length ?? 0;
  let rows = Array.from({ length: rowCount }, (_, i) => i);
  if (rows.length > MAX_ROWS) {
    rows = shuffleInPlace(rows, mulberry32(seed))
      .slice(0, MAX_ROWS)
      .sort((a, b) => a - b);
  }
  if (rows.length < 6) throw new Error('too-few-rows');

  const pipeline = fitPipeline(columns, profiles, featureColumns, rows);
  const X = pipeline.transform(rows);

  const clustering = chooseKmeans(X, seed);
  const projection = pca2(X, seed);

  // Scatter sample.
  let pointIndices = X.map((_, i) => i);
  if (pointIndices.length > MAX_POINTS) {
    pointIndices = shuffleInPlace(pointIndices, mulberry32(seed + 1)).slice(0, MAX_POINTS);
  }
  const points: [number, number, number][] = pointIndices.map((i) => [
    Math.round(projection.points[i][0] * 1000) / 1000,
    Math.round(projection.points[i][1] * 1000) / 1000,
    clustering.assignments[i],
  ]);

  // Cluster members in ORIGINAL row indices, for readable traits.
  const members: number[][] = Array.from({ length: clustering.k }, () => []);
  for (let i = 0; i < rows.length; i++) {
    members[clustering.assignments[i]].push(rows[i]);
  }

  const candidates: TraitCandidate[][] = members.map(() => []);
  for (const name of featureColumns) {
    const profile = profiles.find((p) => p.name === name)!;
    const values = columns.get(name)!;
    const perCluster =
      profile.type === 'numeric'
        ? numericTraits(values, rows, members, name)
        : categoricalTraits(values, rows, members, name);
    perCluster.forEach((list, c) => candidates[c].push(...list));
  }

  const clusters: ClusterSummary[] = members.map((member, id) => ({
    id,
    size: member.length,
    share: member.length / rows.length,
    traits: candidates[id]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, TRAITS_PER_CLUSTER)
      .map((candidate) => candidate.trait),
  }));
  clusters.sort((a, b) => b.size - a.size);

  return {
    k: clustering.k,
    silhouette: clustering.silhouette,
    tried: clustering.tried,
    points,
    explained: projection.explained,
    clusters,
    featureColumns,
    rowsUsed: rows.length,
    seed,
  };
}

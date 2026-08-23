/**
 * V37: comparing more than two runs.
 *
 * V21 answered "did my cleaning help?" — one change, two runs, a diff. Three
 * or four runs answer a different question: "which of the things I tried
 * actually worked?" That is what a long session produces, and reading it as
 * three separate pairwise diffs makes the reader do the joining.
 *
 * Deliberately NOT a second diff engine: the per-model table is a matrix over
 * the same `bestResult` ranking every other surface uses (V35/V36), and the
 * feature columns are a set algebra over the same `summary.featureColumns`
 * V21 reads. What is new is only the shape — N columns instead of a left and
 * a right, and a baseline run every other one is measured against.
 */
import { bestResult, rankingValue } from '@/features/ml/train/ranking';
import type { RunRecord } from '@/features/ml/projects/types';
import type { ModelKey, RankingMetric } from '@/features/ml/train/types';

/** At least two runs to compare; past six the table stops being readable. */
export const MIN_RUNS = 2;
export const MAX_RUNS = 6;

export interface RunColumn {
  id: number;
  name: string;
  createdAt: number;
  /** The run's champion under the shared ranking rule. */
  best: { key: ModelKey; value: number } | null;
  /** Champion value minus the reference run's — null for the reference. */
  delta: number | null;
  featureCount: number;
  /** Columns this run uses that the reference does not, and vice versa. */
  added: string[];
  removed: string[];
}

export interface ManyComparison {
  /** The oldest selected run: everything else is read against it. */
  referenceId: number;
  isClassification: boolean;
  metric: RankingMetric | null;
  /** Runs in selection order, reference first. */
  columns: RunColumn[];
  /** Every model key seen, with each run's value — null where it did not run. */
  models: { key: ModelKey; values: (number | null)[] }[];
  /** Columns present in every run — the stable core of the comparison. */
  sharedFeatures: string[];
  /** False when targets or task families differ: the numbers are not deltas. */
  comparable: boolean;
  /** The run with the best champion, when the set is comparable. */
  leaderId: number | null;
}

export function compareMany(runs: RunRecord[], metric?: RankingMetric): ManyComparison | null {
  if (runs.length < MIN_RUNS || runs.length > MAX_RUNS) return null;

  // Oldest first: the reference is where the session started, so the deltas
  // read as "what my changes did", not "what the newest run happens to be".
  const ordered = [...runs].sort((a, b) => a.createdAt - b.createdAt);
  const reference = ordered[0];
  const isClassification = reference.taskType !== 'regression';
  const comparable = ordered.every(
    (run) =>
      run.target === reference.target && (run.taskType !== 'regression') === isClassification,
  );

  const bestOf = (run: RunRecord) => {
    const best = bestResult(run.results, run.taskType, metric);
    return best === null ? null : { key: best.key, value: rankingValue(best, metric) };
  };
  const referenceBest = bestOf(reference);

  const referenceFeatures = new Set(reference.summary.featureColumns);
  const columns: RunColumn[] = ordered.map((run) => {
    const best = bestOf(run);
    const features = new Set(run.summary.featureColumns);
    return {
      id: run.id ?? 0,
      name: run.name,
      createdAt: run.createdAt,
      best,
      delta:
        comparable && best !== null && referenceBest !== null && run.id !== reference.id
          ? best.value - referenceBest.value
          : null,
      featureCount: features.size,
      added: [...features].filter((f) => !referenceFeatures.has(f)).sort(),
      removed: [...referenceFeatures].filter((f) => !features.has(f)).sort(),
    };
  });

  // The per-model matrix, ordered by the reference run's own ranking so the
  // table reads top-down like the leaderboard the user already knows.
  const seen = new Map<ModelKey, number>();
  ordered.forEach((run, index) => {
    for (const result of run.results) {
      if (result.ok && !seen.has(result.key)) seen.set(result.key, index);
    }
  });
  const referenceOrder = new Map<ModelKey, number>();
  reference.results
    .filter((r) => r.ok)
    .sort((a, b) =>
      isClassification
        ? rankingValue(b, metric) - rankingValue(a, metric)
        : rankingValue(a, metric) - rankingValue(b, metric),
    )
    .forEach((r, i) => referenceOrder.set(r.key, i));

  const models = [...seen.keys()]
    .sort((a, b) => {
      const ai = referenceOrder.get(a) ?? Number.MAX_SAFE_INTEGER;
      const bi = referenceOrder.get(b) ?? Number.MAX_SAFE_INTEGER;
      return ai !== bi ? ai - bi : a.localeCompare(b);
    })
    .map((key) => ({
      key,
      values: ordered.map((run) => {
        const found = run.results.find((r) => r.key === key && r.ok);
        return found === undefined ? null : rankingValue(found, metric);
      }),
    }));

  const sharedFeatures = [...referenceFeatures]
    .filter((f) => ordered.every((run) => run.summary.featureColumns.includes(f)))
    .sort();

  let leaderId: number | null = null;
  if (comparable) {
    let bestValue: number | null = null;
    for (const column of columns) {
      if (column.best === null) continue;
      const better =
        bestValue === null ||
        (isClassification ? column.best.value > bestValue : column.best.value < bestValue);
      if (better) {
        bestValue = column.best.value;
        leaderId = column.id;
      }
    }
  }

  return {
    referenceId: reference.id ?? 0,
    isClassification,
    metric: metric ?? null,
    columns,
    models,
    sharedFeatures,
    comparable,
    leaderId,
  };
}

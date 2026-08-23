/**
 * V35: the robust leaderboard — 5×2 repeated cross-validation.
 *
 * A single test split of a few hundred rows carries roughly ±3 points of
 * standard deviation on accuracy; ranking two models one point apart on one
 * draw is meaningless. On demand (like tuning), every family is retrained on
 * 5 seeded repetitions × 2 halves of the train+validation rows — ten fits per
 * family, ten scores, a mean and a spread. The TEST SET IS NEVER TOUCHED:
 * this is a statement about the ranking, not a second bite at the test.
 */
import { MODEL_TRAIN_CAPS, modelZoo } from '@/features/ml/train/models';
import { fitPipeline, splitIndices } from '@/features/ml/train/pipeline';
import { nestedSampleOrder } from '@/features/ml/train/random';
import { prepareData, scoreModel, yieldToQueue } from '@/features/ml/train/trainer';
import type { Cell, ColumnProfile } from '@/features/ml/data/types';
import type { ModelKey, TrainConfig } from '@/features/ml/train/types';

export const ROBUST_REPS = 5;

export interface RobustEntry {
  model: ModelKey;
  /** Mean of the primary metric across the 2×reps held-out halves. */
  mean: number;
  /** Sample standard deviation across the same folds. */
  sd: number;
  scores: number[];
}

export interface RobustRankResult {
  /** Best mean first (accuracy: higher wins; RMSE: lower wins). */
  entries: RobustEntry[];
  reps: number;
  /** Rows the folds were drawn from (train + validation; never test). */
  rows: number;
  isClassification: boolean;
  /**
   * Fold-paired comparison of the two best means: in how many of the 2×reps
   * folds the leader actually beat the runner-up. 10/10 is a stable ranking;
   * 6/10 means the order between them is inside the noise.
   */
  topPair: { leader: ModelKey; runnerUp: ModelKey; leaderWins: number; folds: number } | null;
}

export interface RobustCallbacks {
  onProgress(done: number, total: number): void;
  isCancelled(): boolean;
}

export async function robustRank(
  columns: Map<string, Cell[]>,
  profiles: ColumnProfile[],
  config: TrainConfig,
  callbacks: RobustCallbacks,
  reps = ROBUST_REPS,
): Promise<RobustRankResult | null> {
  const prepared = prepareData(columns, profiles, config);
  const { isClassification, classes, featureColumns, encode } = prepared;

  // The pool is train + validation — the rows selection is allowed to see.
  const pool = [...prepared.train, ...prepared.validation].sort((a, b) => a - b);
  const targetValues = columns.get(config.target)!;
  const poolLabels = isClassification ? pool.map((i) => (targetValues[i] as string).trim()) : null;

  const zoo = modelZoo(isClassification ? 'classification' : 'regression');
  const scores = new Map<ModelKey, number[]>(zoo.map((def) => [def.key, []]));
  const totalFits = reps * 2 * zoo.length;
  let done = 0;

  const context = {
    task: isClassification ? ('classification' as const) : ('regression' as const),
    classCount: classes.length,
    seed: config.seed,
  };

  for (let rep = 0; rep < reps; rep++) {
    // Each repetition is one seeded stratified half/half split of the pool.
    const halves = splitIndices(pool, poolLabels, 0.5, config.seed + 101 + rep);
    const pairs: [number[], number[]][] = [
      [halves.train, halves.test],
      [halves.test, halves.train],
    ];
    for (const [fitIdx, evalIdx] of pairs) {
      // The strict reading of cross-validation: the pipeline (imputation,
      // encoding, IDF, scaling) is refitted inside every fold.
      const pipeline = fitPipeline(columns, profiles, featureColumns, fitIdx);
      const fullX = pipeline.transform(fitIdx);
      const fullY = fitIdx.map(encode);
      const evalX = pipeline.transform(evalIdx);
      const evalY = evalIdx.map(encode);
      const foldLabels = poolLabels ? fitIdx.map((i) => (targetValues[i] as string).trim()) : null;
      let sampleOrder: number[] | null = null;

      for (const def of zoo) {
        if (callbacks.isCancelled()) return null;
        // V25's announced caps hold here too — ten uncapped forest fits on
        // 80k rows would take minutes for a number the cap changes little.
        const cap = MODEL_TRAIN_CAPS[def.key];
        let fitX = fullX;
        let fitY = fullY;
        if (cap !== undefined && fitIdx.length > cap) {
          sampleOrder ??= nestedSampleOrder(fitIdx.length, foldLabels, config.seed);
          const keep = sampleOrder.slice(0, cap).sort((a, b) => a - b);
          fitX = keep.map((position) => fullX[position]);
          fitY = keep.map((position) => fullY[position]);
        }
        try {
          const model = def.train(fitX, fitY, context);
          const { primary } = scoreModel(model, evalX, evalY, isClassification, classes.length);
          scores.get(def.key)!.push(primary);
        } catch {
          // A family that fails a fold simply reports fewer folds — shown as-is.
        }
        done += 1;
        callbacks.onProgress(done, totalFits);
        await yieldToQueue();
      }
    }
  }

  const entries: RobustEntry[] = [...scores.entries()]
    .filter(([, s]) => s.length > 0)
    .map(([model, s]) => {
      const mean = s.reduce((a, b) => a + b, 0) / s.length;
      const variance =
        s.length > 1 ? s.reduce((a, b) => a + (b - mean) ** 2, 0) / (s.length - 1) : 0;
      return { model, mean, sd: Math.sqrt(variance), scores: s };
    })
    .sort((a, b) => (isClassification ? b.mean - a.mean : a.mean - b.mean));

  let topPair: RobustRankResult['topPair'] = null;
  if (entries.length >= 2 && entries[0].scores.length === entries[1].scores.length) {
    const [leader, runnerUp] = entries;
    let leaderWins = 0;
    for (let f = 0; f < leader.scores.length; f++) {
      const delta = leader.scores[f] - runnerUp.scores[f];
      if (isClassification ? delta > 0 : delta < 0) leaderWins += 1;
    }
    topPair = {
      leader: leader.model,
      runnerUp: runnerUp.model,
      leaderWins,
      folds: leader.scores.length,
    };
  }

  return { entries, reps, rows: pool.length, isClassification, topPair };
}

/**
 * V66: the glass box. One row, replayed through the model that predicts it.
 *
 * Shapley (V28) answers "what weighed". This answers "what happened": the
 * questions a tree asked, the rows a k-NN consulted, the prediction a
 * boosting builds round after round, the trees of a forest that disagreed.
 *
 * One rule holds the module together: THE REPLAY IS THE MODEL. Nothing here
 * approximates. A replay walks the structure the model itself predicts with
 * (its exported parameters, or its own neighbour search), and its last step
 * must equal `predict` on the same row. The tests check it on every test row
 * of the demos; a replay that drifted would tell the story of another model.
 *
 * A model sees encoded columns: a number standardized, a category spread over
 * 0/1 columns, a word weighed by TF-IDF. A threshold "age < -0.31" says
 * nothing to a reader, so `describeSplit` translates what translates exactly
 * (a number back to its unit, a 0/1 column to "is it this category?") and
 * shows the rest as the model sees it, under its encoded name.
 *
 * A trace is not a cause. The path of a tree says which questions were asked
 * of this row, not that the column makes the answer.
 *
 * Measured before the panel was built, six demos, five seeds, 2,560 test rows:
 *
 *   - the replay equals `predict` on every row for the tree, the k-NN and the
 *     boosting. The forest missed three rows of titanic until its tie rule was
 *     copied (see `firstToTheTop`);
 *   - every question of the tree translates into the units of the file on five
 *     demos, and 6 of 1,878 on reviews, whose columns are free text;
 *   - the next row is exactly as far as the last neighbour kept on 17 % of
 *     titanic's test rows and 39 % of energy's, 0 to 1 % elsewhere;
 *   - the boosting's validation error was lowest well before its last round
 *     (more than 2 % under the final error) on 17 runs of 30, and on energy it
 *     never beat its starting point on three seeds of five. The replay shows
 *     it and sets nothing. V67 measured the obvious fix, stopping at that
 *     round, and found it does not predict better: see `gbdt.ts`.
 *
 * Pure and deterministic.
 */
import { isMissing, parseNumber } from '@/features/ml/data/infer';
import type { Cell } from '@/features/ml/data/types';
import { binValue, type GbdtTree } from '@/features/ml/train/gbdt';
import { KNN_K, type TrainedModel } from '@/features/ml/train/models';
import type { TrainArtifacts } from '@/features/ml/train/trainer';
import type { ModelKey } from '@/features/ml/train/types';
import type { FittedPipeline } from '@/features/ml/train/pipeline';

type Specs = FittedPipeline['specs'];

/** How many boosting rounds are told in full. */
const TOLD_ROUNDS = 3;

// --- Reading an encoded split in the units of the file ----------------------

/**
 * One question a tree asked of the row. `asked` is the test as the reader can
 * check it; `passed` is whether the row passed it.
 */
export interface SplitStep {
  /** The encoded feature, as the model names it (`sex=male`, `review:great`). */
  feature: string;
  /** The source column of the file. */
  column: string;
  kind: 'numeric' | 'category' | 'word' | 'rank';
  /**
   * - `numeric`: is the column below (`<`) or at most (`<=`) `threshold`, in
   *   the unit of the file?
   * - `category`: is the column this `category`?
   * - `word`, `rank`: the encoded value against the encoded threshold, shown
   *   as the model sees them.
   */
  operator: '<' | '<=' | 'is';
  threshold?: number;
  category?: string;
  /** The row's value: in the unit of the file when `kind` is numeric. */
  value?: number;
  /** Whether the row passed the test as `operator` states it. */
  passed: boolean;
  /** Training rows that reached this question, when the caller counted them. */
  rows?: number;
}

interface FeatureOrigin {
  spec: Specs[number];
  /** Position inside the spec: which category, which term. */
  offset: number;
  feature: string;
}

/** For each encoded feature, the spec it comes from. Same order as `buildRowEncoder`. */
export function featureOrigins(specs: Specs): FeatureOrigin[] {
  const origins: FeatureOrigin[] = [];
  for (const spec of specs) {
    if (spec.kind === 'onehot') {
      spec.categories.forEach((category, offset) =>
        origins.push({ spec, offset, feature: `${spec.name}=${category}` }),
      );
    } else if (spec.kind === 'text') {
      spec.terms.forEach((term, offset) =>
        origins.push({ spec, offset, feature: `${spec.name}:${term}` }),
      );
    } else {
      origins.push({ spec, offset: 0, feature: spec.name });
    }
  }
  return origins;
}

/**
 * One split as a question. `goesLeft` is what the model did with the row;
 * `strict` tells `<` (the tree of ml-cart) from `<=` (the boosting).
 */
export function describeSplit(
  origin: FeatureOrigin,
  encodedThreshold: number,
  encodedValue: number,
  goesLeft: boolean,
  strict: boolean,
): SplitStep {
  const { spec, feature } = origin;
  if (spec.kind === 'numeric') {
    return {
      feature,
      column: spec.name,
      kind: 'numeric',
      operator: strict ? '<' : '<=',
      threshold: encodedThreshold * spec.std + spec.mean,
      value: encodedValue * spec.std + spec.mean,
      passed: goesLeft,
    };
  }
  if (spec.kind === 'onehot') {
    // A 0/1 column: the left side is always "not this category".
    return {
      feature,
      column: spec.name,
      kind: 'category',
      operator: 'is',
      category: spec.categories[origin.offset],
      passed: !goesLeft,
    };
  }
  return {
    feature,
    column: spec.name,
    kind: spec.kind === 'text' ? 'word' : 'rank',
    operator: strict ? '<' : '<=',
    threshold: encodedThreshold,
    value: encodedValue,
    passed: goesLeft,
  };
}

// --- Decision tree (ml-cart) -------------------------------------------------

/** A node of ml-cart as its JSON gives it. A leaf has no children. */
interface CartNode {
  splitColumn?: number;
  splitValue?: number;
  left?: CartNode;
  right?: CartNode;
  /** Leaf: class probabilities as a 1 x k matrix, or the mean in regression. */
  distribution?: number | number[][] | { data: ArrayLike<number>[] };
}

function leafProbabilities(distribution: CartNode['distribution']): number[] {
  if (distribution === undefined || typeof distribution === 'number') return [];
  const rows = Array.isArray(distribution) ? distribution : distribution.data;
  return Array.from(rows[0] ?? []);
}

/** Walks one cart tree. `columns` maps the tree's own column numbers to the row's. */
function walkCart(
  root: CartNode,
  row: readonly number[],
  columns: readonly number[] | null,
  visit?: (column: number, threshold: number, value: number, goesLeft: boolean) => void,
): CartNode {
  let node = root;
  while (node.left && node.right) {
    const column = columns ? columns[node.splitColumn!] : node.splitColumn!;
    const value = row[column];
    const goesLeft = value < node.splitValue!;
    visit?.(column, node.splitValue!, value, goesLeft);
    node = goesLeft ? node.left : node.right;
  }
  return node;
}

function cartAnswer(leaf: CartNode, isClassification: boolean): number {
  if (!isClassification) return leaf.distribution as number;
  const probabilities = leafProbabilities(leaf.distribution);
  return probabilities.indexOf(Math.max(...probabilities));
}

export interface TreeReplay {
  kind: 'tree';
  steps: SplitStep[];
  /** The class index, or the value: what `predict` returns. */
  prediction: number;
  /** Class shares the leaf holds (classification). */
  leafShares?: number[];
  /** Training rows that end in this leaf, and what they are. */
  leaf?: { rows: number; counts?: number[]; mean?: number };
}

/** The rows the tree was fitted on, encoded, to count who reached each question. */
export interface FittedRows {
  x: readonly (readonly number[])[];
  y: readonly number[];
}

function cartRoot(model: TrainedModel): CartNode {
  // Through JSON on purpose: a tree fitted here holds class instances, a tree
  // rebuilt from a helper core holds plain objects. Both read the same after.
  const json = JSON.parse(JSON.stringify(model.toJSON!())) as { model: { root: CartNode } };
  return json.model.root;
}

export function replayTree(
  model: TrainedModel,
  row: readonly number[],
  specs: Specs,
  isClassification: boolean,
  classCount: number,
  fitted?: FittedRows,
): TreeReplay {
  const root = cartRoot(model);
  const origins = featureOrigins(specs);
  const steps: SplitStep[] = [];
  /** The questions the row met, in order: the nodes of its path. */
  const path: CartNode[] = [];
  let leaf = root;
  while (leaf.left && leaf.right) {
    const value = row[leaf.splitColumn!];
    const goesLeft = value < leaf.splitValue!;
    steps.push(describeSplit(origins[leaf.splitColumn!], leaf.splitValue!, value, goesLeft, true));
    path.push(leaf);
    leaf = goesLeft ? leaf.left : leaf.right;
  }

  let reached: TreeReplay['leaf'];
  if (fitted) {
    // Each fitted row walks the tree for as long as it stays on the path of
    // the replayed row: it counts at every question they share, and in the
    // leaf when they share them all.
    const atStep = new Array<number>(steps.length).fill(0);
    const counts = new Array<number>(classCount).fill(0);
    let rows = 0;
    let sum = 0;
    fitted.x.forEach((other, i) => {
      let node = root;
      let depth = 0;
      while (node.left && node.right && node === path[depth]) {
        atStep[depth] += 1;
        node = other[node.splitColumn!] < node.splitValue! ? node.left : node.right;
        depth += 1;
      }
      if (node === leaf) {
        rows += 1;
        if (isClassification) counts[fitted.y[i]] += 1;
        else sum += fitted.y[i];
      }
    });
    steps.forEach((step, depth) => (step.rows = atStep[depth]));
    reached = isClassification ? { rows, counts } : { rows, ...(rows > 0 && { mean: sum / rows }) };
  }

  return {
    kind: 'tree',
    steps,
    prediction: cartAnswer(leaf, isClassification),
    ...(isClassification && { leafShares: leafProbabilities(leaf.distribution) }),
    ...(reached && { leaf: reached }),
  };
}

// --- Random forest (ml-random-forest) -----------------------------------------

export interface ForestReplay {
  kind: 'forest';
  trees: number;
  /** What `predict` returns: the most voted class, or the mean of the trees. */
  prediction: number;
  /** Classification: how many trees answered each class. */
  votes?: number[];
  /** Two classes got the same number of trees: the first to get there wins. */
  tiedVote?: boolean;
  /** Regression: the spread of the trees' answers. */
  spread?: { min: number; max: number; mean: number };
}

/**
 * The most voted class as ml-random-forest picks it: the first class to
 * REACH the highest count, in the order of the trees. On a tie that is not
 * the smallest class, and three test rows of titanic tell the difference.
 */
function firstToTheTop(answers: readonly number[], classCount: number): number {
  const counts = new Array<number>(classCount).fill(0);
  let best = answers[0] ?? 0;
  let bestCount = 0;
  for (const answer of answers) {
    counts[answer] += 1;
    if (counts[answer] > bestCount) {
      bestCount = counts[answer];
      best = answer;
    }
  }
  return best;
}

export function replayForest(
  model: TrainedModel,
  row: readonly number[],
  isClassification: boolean,
  classCount: number,
): ForestReplay {
  interface ForestJson {
    indexes: number[][];
    estimators: { root: CartNode }[];
  }
  // ml-random-forest nests its parameters one level down, under `baseModel`.
  const json = JSON.parse(JSON.stringify(model.toJSON!())) as {
    model: ForestJson & { baseModel?: ForestJson };
  };
  const forest = json.model.baseModel ?? json.model;
  const answers = forest.estimators.map((estimator, i) =>
    cartAnswer(walkCart(estimator.root, row, forest.indexes[i]), isClassification),
  );
  if (isClassification) {
    const votes = new Array<number>(classCount).fill(0);
    for (const answer of answers) votes[answer] += 1;
    const top = Math.max(...votes);
    return {
      kind: 'forest',
      trees: answers.length,
      prediction: firstToTheTop(answers, classCount),
      votes,
      tiedVote: votes.filter((count) => count === top).length > 1,
    };
  }
  const mean = answers.reduce((a, v) => a + v, 0) / (answers.length || 1);
  return {
    kind: 'forest',
    trees: answers.length,
    prediction: mean,
    spread: { min: Math.min(...answers), max: Math.max(...answers), mean },
  };
}

// --- k nearest neighbours -------------------------------------------------------

export interface Neighbour {
  /** Position in the rows the family was fitted on. */
  index: number;
  distance: number;
  /** The class index, or the value. */
  label: number;
}

export interface NeighboursReplay {
  kind: 'knn';
  neighbours: Neighbour[];
  prediction: number;
  /** Classification: the votes per class. */
  votes?: number[];
  /**
   * The next row is exactly as far as the last neighbour kept: another row
   * order, or another library, would have kept the other one (V64).
   */
  tieAtTheEdge: boolean;
  /** Two classes got the same number of votes: the first in order wins. */
  tiedVote: boolean;
}

export function replayNeighbours(
  model: TrainedModel,
  row: number[],
  k: number,
  isClassification: boolean,
  classCount: number,
): NeighboursReplay {
  const found = model.neighbours!(row, k + 1);
  const neighbours = found.slice(0, k);
  const tieAtTheEdge =
    found.length > k && found[k].distance === neighbours[neighbours.length - 1].distance;
  if (!isClassification) {
    const mean = neighbours.reduce((a, n) => a + n.label, 0) / (neighbours.length || 1);
    return { kind: 'knn', neighbours, prediction: mean, tieAtTheEdge, tiedVote: false };
  }
  const votes = new Array<number>(classCount).fill(0);
  for (const neighbour of neighbours) votes[neighbour.label] += 1;
  const top = Math.max(...votes);
  return {
    kind: 'knn',
    neighbours,
    prediction: votes.indexOf(top),
    votes,
    tieAtTheEdge,
    tiedVote: votes.filter((count) => count === top).length > 1,
  };
}

// --- Gradient boosting ------------------------------------------------------------

interface BoosterJson {
  baseScore: number;
  trees: GbdtTree[];
  edges: number[][];
}

interface GbdtJson {
  task: 'regression' | 'classification';
  learningRate: number;
  boosters: BoosterJson[];
}

function gbdtJson(model: TrainedModel): GbdtJson {
  const json = model.toJSON!() as {
    task: GbdtJson['task'];
    learningRate: number;
    boosters?: BoosterJson[];
    baseScore?: number;
    trees?: GbdtTree[];
    edges?: number[][];
  };
  return {
    task: json.task,
    learningRate: json.learningRate,
    boosters: json.boosters ?? [
      { baseScore: json.baseScore!, trees: json.trees!, edges: json.edges! },
    ],
  };
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

/** Raw score of one booster after 0, 1, 2... rounds, for one row. */
function stagedScores(booster: BoosterJson, row: readonly number[], rate: number): number[] {
  const binned = row.map((value, j) => binValue(booster.edges[j], value));
  const scores = [booster.baseScore];
  let score = booster.baseScore;
  for (const tree of booster.trees) {
    let node = tree.nodes[0];
    while (node.feature !== -1) {
      node =
        binned[node.feature] <= node.threshold ? tree.nodes[node.left] : tree.nodes[node.right];
    }
    score += rate * node.value;
    scores.push(score);
  }
  return scores;
}

/** A booster that stopped early keeps its last score for the rounds it did not run. */
function at(scores: readonly number[], round: number): number {
  return scores[Math.min(round, scores.length - 1)];
}

/** What the model answers after `round` rounds: the value, or the class shares. */
function answerAt(staged: readonly number[][], round: number, json: GbdtJson): number[] {
  if (json.task === 'regression') return [at(staged[0], round)];
  if (staged.length === 1) {
    const p = sigmoid(at(staged[0], round));
    return [1 - p, p];
  }
  const scores = staged.map((scores) => sigmoid(at(scores, round)));
  const sum = scores.reduce((a, v) => a + v, 0) || 1;
  return scores.map((v) => v / sum);
}

export interface BoostingReplay {
  kind: 'gbdt';
  rounds: number;
  /** The class index, or the value: what `predict` returns. */
  prediction: number;
  /** Final class shares (classification). */
  shares?: number[];
  /**
   * After 0, 1, 2... rounds: the predicted value, or the share of the class
   * finally predicted. `curve[0]` is the starting point every row shares.
   */
  curve: number[];
  /** The first round after which the curve has made 90 % of its whole move. */
  settledAt: number;
  /**
   * The rounds that moved the curve most among those asking different
   * questions, with the questions their tree asked.
   */
  told: {
    round: number;
    from: number;
    to: number;
    steps: SplitStep[];
    /** Other rounds whose tree asked this row exactly the same questions. */
    sameQuestions: number;
  }[];
}

export function replayBoosting(
  model: TrainedModel,
  row: readonly number[],
  specs: Specs,
): BoostingReplay {
  const json = gbdtJson(model);
  const staged = json.boosters.map((booster) => stagedScores(booster, row, json.learningRate));
  const rounds = Math.max(...staged.map((scores) => scores.length - 1));
  const last = answerAt(staged, rounds, json);
  const isClassification = json.task === 'classification';
  const prediction = isClassification ? last.indexOf(Math.max(...last)) : last[0];
  const watched = isClassification ? prediction : 0;

  const curve: number[] = [];
  for (let round = 0; round <= rounds; round++) curve.push(answerAt(staged, round, json)[watched]);

  const move = curve[rounds] - curve[0];
  let settledAt = rounds;
  for (let round = 0; round <= rounds; round++) {
    if (Math.abs(curve[round] - curve[0]) >= 0.9 * Math.abs(move)) {
      settledAt = round;
      break;
    }
  }

  // The tree told for a round is the one of the watched class: in multiclass
  // each class has its own booster, and the others only rescale the share.
  const booster = json.boosters[json.boosters.length === 1 ? 0 : watched];
  const origins = featureOrigins(specs);
  const binned = row.map((value, j) => binValue(booster.edges[j], value));
  const pathOf = (round: number): SplitStep[] => {
    const steps: SplitStep[] = [];
    const tree = booster.trees[round - 1];
    let node = tree?.nodes[0];
    while (node && node.feature !== -1) {
      const goesLeft = binned[node.feature] <= node.threshold;
      steps.push(
        describeSplit(
          origins[node.feature],
          booster.edges[node.feature][node.threshold],
          row[node.feature],
          goesLeft,
          false,
        ),
      );
      node = goesLeft ? tree.nodes[node.left] : tree.nodes[node.right];
    }
    return steps;
  };
  // The first rounds always move a row most, and often ask the same questions
  // again: telling rounds 1, 2 and 3 would tell one tree three times. So the
  // rounds told are the largest movers whose questions DIFFER, and each says
  // how many other rounds asked this row exactly the same.
  const signature = (steps: SplitStep[]) =>
    steps.map((step) => `${step.feature}|${step.threshold ?? ''}|${step.passed}`).join('>');
  const paths = new Map<number, { steps: SplitStep[]; key: string }>();
  const sameAs = new Map<string, number>();
  for (let round = 1; round <= Math.min(rounds, booster.trees.length); round++) {
    const steps = pathOf(round);
    const key = signature(steps);
    paths.set(round, { steps, key });
    sameAs.set(key, (sameAs.get(key) ?? 0) + 1);
  }
  const seen = new Set<string>();
  const told: BoostingReplay['told'] = [];
  const movers = curve
    .slice(1)
    .map((value, i) => ({ round: i + 1, from: curve[i], to: value }))
    .filter((item) => item.to !== item.from && paths.has(item.round))
    .sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from) || a.round - b.round);
  for (const item of movers) {
    const { steps, key } = paths.get(item.round)!;
    if (seen.has(key)) continue;
    seen.add(key);
    told.push({ ...item, steps, sameQuestions: (sameAs.get(key) ?? 1) - 1 });
    if (told.length === TOLD_ROUNDS) break;
  }
  told.sort((a, b) => a.round - b.round);

  return {
    kind: 'gbdt',
    rounds,
    prediction,
    ...(isClassification && { shares: last }),
    curve,
    settledAt,
    told,
  };
}

export interface StagedValidation {
  /** `rmse` in regression, `logLoss` in classification. Lower is better. */
  metric: 'rmse' | 'logLoss';
  /** The error on the validation rows after 0, 1, 2... rounds. */
  curve: number[];
  /** The round with the lowest error. */
  bestRound: number;
  rows: number;
}

/**
 * The error on the validation rows as the rounds add up. It shows whether the
 * last rounds still helped; it sets nothing. Read on validation and never on
 * the test set, which would otherwise be choosing a number of rounds (V60).
 */
export function stagedValidation(
  model: TrainedModel,
  validationX: readonly (readonly number[])[],
  validationY: readonly number[],
): StagedValidation | null {
  if (validationX.length === 0) return null;
  const json = gbdtJson(model);
  const perRow = validationX.map((row) =>
    json.boosters.map((booster) => stagedScores(booster, row, json.learningRate)),
  );
  const rounds = Math.max(...perRow[0].map((scores) => scores.length - 1));
  const regression = json.task === 'regression';
  const curve: number[] = [];
  for (let round = 0; round <= rounds; round++) {
    let total = 0;
    perRow.forEach((staged, i) => {
      const answer = answerAt(staged, round, json);
      if (regression) total += (answer[0] - validationY[i]) ** 2;
      else total += -Math.log(Math.max(answer[validationY[i]] ?? 0, 1e-12));
    });
    const mean = total / perRow.length;
    curve.push(regression ? Math.sqrt(mean) : mean);
  }
  let bestRound = 0;
  for (let round = 1; round <= rounds; round++)
    if (curve[round] < curve[bestRound]) bestRound = round;
  return { metric: regression ? 'rmse' : 'logLoss', curve, bestRound, rows: perRow.length };
}

// --- One row, one model: what the worker answers ---------------------------------

/** A neighbour as the reader can find it in the file. */
export interface NeighbourRow {
  /** Data row of the file, counted from 1. Null when the run kept no row numbers. */
  row: number | null;
  /** The target cell of that row, as written in the file. */
  target: string;
  /** The cells of `columns`, in order. */
  cells: string[];
}

export type Replay =
  | TreeReplay
  | ForestReplay
  | (NeighboursReplay & { columns: string[]; rows: NeighbourRow[] })
  | (BoostingReplay & { validation: StagedValidation | null })
  /** A family with no steps to tell: the panel says why. */
  | { kind: 'none' };

export interface GlassBoxPayload {
  model: ModelKey;
  isClassification: boolean;
  classes: string[];
  replay: Replay;
}

/** What a replay computes once per run and reuses for every row. */
export interface GlassBoxCache {
  treeFit?: FittedRows | null;
  validation?: StagedValidation | null;
}

/** The columns shown beside a neighbour: enough to recognise the row, not the whole file. */
const NEIGHBOUR_COLUMNS = 6;

function cellText(cell: Cell | undefined): string {
  return isMissing(cell ?? null) ? '' : String(cell).trim();
}

export function replayRow(
  artifacts: TrainArtifacts,
  modelKey: ModelKey,
  values: Record<string, Cell>,
  columns: Map<string, Cell[]>,
  target: string,
  cache: GlassBoxCache = {},
): GlassBoxPayload {
  const model = artifacts.models.get(modelKey);
  if (!model) throw new Error('model-not-found');
  const { isClassification, classes, pipeline } = artifacts;
  const row = pipeline.transformRow(values);
  const base = { model: modelKey, isClassification, classes };
  const fitIndices = artifacts.fitIndices?.[modelKey] ?? artifacts.trainIndices;
  const targetCells = columns.get(target);

  if (modelKey === 'tree' && model.toJSON) {
    if (cache.treeFit === undefined) {
      cache.treeFit = null;
      if (fitIndices && targetCells) {
        const y = fitIndices.map((index) => {
          const text = cellText(targetCells[index]);
          return isClassification ? classes.indexOf(text) : (parseNumber(text) ?? Number.NaN);
        });
        cache.treeFit = { x: pipeline.transform(fitIndices), y };
      }
    }
    return {
      ...base,
      replay: replayTree(
        model,
        row,
        pipeline.specs,
        isClassification,
        classes.length,
        cache.treeFit ?? undefined,
      ),
    };
  }
  if (modelKey === 'forest' && model.toJSON) {
    return { ...base, replay: replayForest(model, row, isClassification, classes.length) };
  }
  if (modelKey === 'knn' && model.neighbours) {
    const replay = replayNeighbours(model, row, KNN_K, isClassification, classes.length);
    const shown = [...new Set(pipeline.specs.map((spec) => spec.name))].slice(0, NEIGHBOUR_COLUMNS);
    const rows = replay.neighbours.map((neighbour): NeighbourRow => {
      const index = fitIndices?.[neighbour.index];
      return {
        row: index === undefined ? null : index + 1,
        target:
          index === undefined
            ? isClassification
              ? (classes[neighbour.label] ?? '')
              : String(neighbour.label)
            : cellText(targetCells?.[index]),
        cells: shown.map((name) =>
          index === undefined ? '' : cellText(columns.get(name)?.[index]),
        ),
      };
    });
    return { ...base, replay: { ...replay, columns: shown, rows } };
  }
  if (modelKey === 'gbdt' && model.toJSON) {
    if (cache.validation === undefined) {
      cache.validation = stagedValidation(model, artifacts.validationX, artifacts.validationY);
    }
    return {
      ...base,
      replay: { ...replayBoosting(model, row, pipeline.specs), validation: cache.validation },
    };
  }
  return { ...base, replay: { kind: 'none' } };
}

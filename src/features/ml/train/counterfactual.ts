/**
 * V68: counterfactuals. For one row, the smallest change of its values that
 * makes the inspected model answer another class.
 *
 * The what-if panel says what the model predicts, Shapley (V28) what weighed,
 * the glass box (V66) what happened. This answers the question a person told
 * "no" actually asks: what would have had to be different?
 *
 * A search, not an optimisation, and one a reader can follow:
 *
 *   1. one column at a time: each value OBSERVED in the training rows is tried
 *      in the place of the row's own; a column keeps the nearest value that
 *      flips the answer;
 *   2. only when no single column flips it: two columns at a time, on a
 *      thinner grid of the same observed values;
 *   3. never three. A change of five columns is no longer an explanation.
 *
 * Rules the code keeps:
 *   - a column the user locked is never changed; the lab does not guess that
 *     an age or a sex cannot change;
 *   - a value tried is a value some training row holds: no interpolation, no
 *     number outside the file, no category that does not exist. Free text is
 *     never edited;
 *   - nothing found is an answer too, returned with what was tried.
 *
 * A counterfactual speaks of the model, not of the world: "the model would
 * answer yes" is not "do this and you will get yes". Two readings are given
 * with each one, because the measure showed they were needed (see PLAN.md,
 * V68): whether the changed row still looks like a training row, and how many
 * of the other trained models follow the same change.
 *
 * Measured before the panel, four classification demos, 60 test rows per run,
 * seven families: one column is enough on 63 to 100 % of the rows of three
 * demos and two are needed on up to 69 %; on reviews most families find
 * nothing, the answer being in the text; a search costs 30 ms at most. The
 * nearest change was farther from every training row than training rows are
 * from each other on 8 to 60 % of the rows, hence `far` and the preference
 * for a change that is not; and 14 to 54 % of the other models followed it,
 * hence `followed`.
 *
 * Pure and deterministic.
 */
import type { Cell } from '@/features/ml/data/types';
import type { TrainArtifacts } from '@/features/ml/train/trainer';
import type { ModelKey } from '@/features/ml/train/types';

/** How many distinct observed values a column offers the one-column search. */
export const SINGLE_GRID = 40;
/** And each column of a pair: the pair search is quadratic in this. */
export const PAIR_GRID = 10;
/** How many counterfactuals are returned at most. */
export const KEPT = 3;

export interface CandidateColumn {
  name: string;
  kind: 'numeric' | 'category';
  /** Values observed in the training rows, as written in the file. */
  values: string[];
  /** Numeric: the standard deviation of the column, to compare changes across columns. */
  scale?: number;
}

export interface Change {
  column: string;
  from: string;
  to: string;
}

export interface Counterfactual {
  changes: Change[];
  /** The class the model answers once the changes are made. */
  prediction: number;
  /** Its probability, when the family gives one. */
  probability?: number;
  /** Number of columns first, then this: changes in standard deviations, 1 per category. */
  distance: number;
  /**
   * The changed row is farther from every training row than training rows
   * usually are from each other: the model is answering where it saw nothing.
   * Absent when the caller gave no way to tell.
   */
  far?: boolean;
}

export interface Answer {
  label: number;
  probability?: number;
}

export interface SearchInput {
  /** The row, as the what-if form holds it. */
  values: Record<string, string>;
  columns: CandidateColumn[];
  locked: ReadonlySet<string>;
  /** What the model answers for the row as it is. */
  current: number;
  /** The class wanted, or null for any class other than the current one. */
  target: number | null;
  /** The model: one answer per row, in order. */
  predict(rows: Record<string, string>[]): Answer[];
  /**
   * Whether a changed row is far from every training row. When given, a
   * column keeps its nearest flipping value that is NOT far, and falls back
   * on a far one, flagged, only when it has no other.
   */
  far?(row: Record<string, string>): boolean;
}

export interface SearchResult {
  found: Counterfactual[];
  /** 1 when one column was enough, 2 when pairs were needed, 0 when nothing flips. */
  columnsChanged: 0 | 1 | 2;
  /** What was tried, for the refusal to say so. */
  tried: { columns: string[]; locked: string[]; rows: number; pairs: boolean };
}

function asNumber(text: string): number {
  const value = Number(text.trim().replace(',', '.'));
  return Number.isFinite(value) ? value : Number.NaN;
}

/**
 * Up to `limit` of the distinct values a column holds in the training rows:
 * for a number, evenly spread over the sorted distinct values, both ends
 * kept; for a category, the most frequent first.
 */
export function observedValues(
  cells: readonly (string | null | undefined)[],
  kind: CandidateColumn['kind'],
  limit: number,
): string[] {
  const counts = new Map<string, number>();
  for (const cell of cells) {
    const text = (cell ?? '').trim();
    if (text === '') continue;
    counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  if (kind === 'category') {
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([value]) => value);
  }
  const numbers = [...counts.keys()]
    .map((text) => ({ text, value: asNumber(text) }))
    .filter((item) => !Number.isNaN(item.value))
    .sort((a, b) => a.value - b.value || a.text.localeCompare(b.text));
  // The same number written twice ("3" and "3.0") is one value.
  const distinct = numbers.filter((item, i) => i === 0 || item.value !== numbers[i - 1].value);
  if (distinct.length <= limit) return distinct.map((item) => item.text);
  const picked: string[] = [];
  for (let i = 0; i < limit; i++) {
    picked.push(distinct[Math.round((i * (distinct.length - 1)) / (limit - 1))].text);
  }
  return [...new Set(picked)];
}

/** How far one change is: in standard deviations for a number, 1 for a category. */
function changeDistance(column: CandidateColumn, from: string, to: string): number {
  if (column.kind === 'category') return 1;
  const a = asNumber(from);
  const b = asNumber(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return 1;
  return Math.abs(a - b) / (column.scale && column.scale > 0 ? column.scale : 1);
}

function same(column: CandidateColumn, a: string, b: string): boolean {
  if (column.kind === 'numeric') {
    const x = asNumber(a);
    const y = asNumber(b);
    if (!Number.isNaN(x) && !Number.isNaN(y)) return x === y;
  }
  return a.trim() === b.trim();
}

/** A thinner grid for the pair search: evenly spread, order kept. */
function thin(values: string[], limit: number): string[] {
  if (values.length <= limit) return values;
  const picked: string[] = [];
  for (let i = 0; i < limit; i++) {
    picked.push(values[Math.round((i * (values.length - 1)) / (limit - 1))]);
  }
  return [...new Set(picked)];
}

interface Flip {
  row: Record<string, string>;
  answer: Answer;
  changes: Change[];
  distance: number;
}

/**
 * Of the changes that flip the answer, the nearest one whose row still looks
 * like a training row; a far one, flagged, only when there is no other. The
 * flips are walked nearest first, so `far` is asked as few times as possible.
 */
function nearest(flips: Flip[], far: SearchInput['far']): Counterfactual | null {
  if (flips.length === 0) return null;
  // A stable sort: among equal distances the order of the candidates holds,
  // which for a category is most frequent first.
  const ordered = [...flips].sort((a, b) => a.distance - b.distance);
  const build = (flip: Flip, isFar?: boolean): Counterfactual => ({
    changes: flip.changes,
    prediction: flip.answer.label,
    ...(flip.answer.probability !== undefined && { probability: flip.answer.probability }),
    distance: flip.distance,
    ...(isFar !== undefined && { far: isFar }),
  });
  if (!far) return build(ordered[0]);
  for (const flip of ordered) if (!far(flip.row)) return build(flip, false);
  return build(ordered[0], true);
}

/** Plausible first, then the smallest change. */
function byRank(a: Counterfactual, b: Counterfactual): number {
  return Number(a.far ?? false) - Number(b.far ?? false) || a.distance - b.distance;
}

export function searchCounterfactuals(input: SearchInput): SearchResult {
  const { values, current, target, predict } = input;
  const open = input.columns.filter(
    (column) => !input.locked.has(column.name) && column.values.length > 0,
  );
  const flips = (answer: Answer) =>
    target === null ? answer.label !== current : answer.label === target;
  let rows = 0;

  // --- One column at a time ---------------------------------------------------
  const singles: Counterfactual[] = [];
  for (const column of open) {
    const from = values[column.name] ?? '';
    const tries = column.values.filter((value) => !same(column, value, from));
    if (tries.length === 0) continue;
    const answers = predict(tries.map((to) => ({ ...values, [column.name]: to })));
    rows += tries.length;
    // The nearest value that flips; candidates come most-frequent-first for a
    // category, so among equals the commonest wins.
    const best = nearest(
      tries.flatMap((to, i) =>
        flips(answers[i])
          ? [
              {
                row: { ...values, [column.name]: to },
                answer: answers[i],
                changes: [{ column: column.name, from, to }],
                distance: changeDistance(column, from, to),
              },
            ]
          : [],
      ),
      input.far,
    );
    if (best !== null) singles.push(best);
  }
  const tried = {
    columns: open.map((column) => column.name),
    locked: input.columns
      .filter((column) => input.locked.has(column.name))
      .map((column) => column.name),
  };
  if (singles.length > 0) {
    singles.sort((a, b) => byRank(a, b) || a.changes[0].column.localeCompare(b.changes[0].column));
    return {
      found: singles.slice(0, KEPT),
      columnsChanged: 1,
      tried: { ...tried, rows, pairs: false },
    };
  }

  // --- Two columns at a time ---------------------------------------------------
  const pairs: Counterfactual[] = [];
  for (let a = 0; a < open.length; a++) {
    for (let b = a + 1; b < open.length; b++) {
      const first = open[a];
      const second = open[b];
      const fromA = values[first.name] ?? '';
      const fromB = values[second.name] ?? '';
      const triesA = thin(first.values, PAIR_GRID).filter((value) => !same(first, value, fromA));
      const triesB = thin(second.values, PAIR_GRID).filter((value) => !same(second, value, fromB));
      const batch: { toA: string; toB: string }[] = [];
      for (const toA of triesA) for (const toB of triesB) batch.push({ toA, toB });
      if (batch.length === 0) continue;
      const answers = predict(
        batch.map(({ toA, toB }) => ({ ...values, [first.name]: toA, [second.name]: toB })),
      );
      rows += batch.length;
      const best = nearest(
        batch.flatMap(({ toA, toB }, i) =>
          flips(answers[i])
            ? [
                {
                  row: { ...values, [first.name]: toA, [second.name]: toB },
                  answer: answers[i],
                  changes: [
                    { column: first.name, from: fromA, to: toA },
                    { column: second.name, from: fromB, to: toB },
                  ],
                  distance: changeDistance(first, fromA, toA) + changeDistance(second, fromB, toB),
                },
              ]
            : [],
        ),
        input.far,
      );
      if (best !== null) pairs.push(best);
    }
  }
  pairs.sort(
    (a, b) =>
      byRank(a, b) ||
      a.changes
        .map((change) => change.column)
        .join()
        .localeCompare(b.changes.map((change) => change.column).join()),
  );
  return {
    found: pairs.slice(0, KEPT),
    columnsChanged: pairs.length > 0 ? 2 : 0,
    tried: { ...tried, rows, pairs: true },
  };
}

// --- One row, one model: what the worker answers ---------------------------------

/** A counterfactual with the second reading: do the other models follow? */
export interface ReadCounterfactual extends Counterfactual {
  /**
   * Of the other trained models that answered like this one for the row as it
   * was, how many answer the new class once the changes are made. A change
   * few models follow is an edge of this model, not a rule of the data.
   */
  followed: { by: number; of: number };
}

export interface CounterfactualPayload {
  model: ModelKey;
  classes: string[];
  current: number;
  target: number | null;
  found: ReadCounterfactual[];
  columnsChanged: SearchResult['columnsChanged'];
  tried: SearchResult['tried'];
  /** Columns the search never edits: free text. */
  untouched: string[];
}

/** What a search computes once per run and reuses for every row. */
export interface CounterfactualCache {
  columns?: CandidateColumn[];
  untouched?: string[];
  /** A sample of the encoded training rows, and how far apart they usually are. */
  cloud?: { rows: number[][]; reach: number } | null;
}

/** Enough rows to know the cloud, few enough to ask it thousands of times. */
const CLOUD_ROWS = 400;
/** A row is far when it is farther from the cloud than 95 % of the cloud's own rows are. */
const CLOUD_SHARE = 0.95;

function squared(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  for (let j = 0; j < a.length; j++) sum += (a[j] - b[j]) ** 2;
  return sum;
}

function nearestSquared(row: readonly number[], rows: readonly number[][], skip = -1): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < rows.length; i++) {
    if (i === skip) continue;
    const distance = squared(row, rows[i]);
    if (distance < best) best = distance;
  }
  return best;
}

/** Null for a regression: "another class" has no meaning for a value. */
export function counterfactualsFor(
  artifacts: TrainArtifacts,
  modelKey: ModelKey,
  values: Record<string, string>,
  locked: readonly string[],
  target: number | null,
  columns: Map<string, Cell[]>,
  cache: CounterfactualCache = {},
): CounterfactualPayload | null {
  if (!artifacts.isClassification) return null;
  const model = artifacts.models.get(modelKey);
  if (!model) throw new Error('model-not-found');
  const { pipeline, classes } = artifacts;
  const fitted = artifacts.fitIndices?.[modelKey] ?? artifacts.trainIndices ?? [];

  if (cache.columns === undefined) {
    const candidates: CandidateColumn[] = [];
    const untouched: string[] = [];
    for (const spec of pipeline.specs) {
      if (spec.kind === 'text') {
        untouched.push(spec.name);
        continue;
      }
      const kind = spec.kind === 'numeric' ? 'numeric' : 'category';
      const cells = columns.get(spec.name) ?? [];
      candidates.push({
        name: spec.name,
        kind,
        values: observedValues(
          (artifacts.trainIndices ?? []).map((index) => cells[index] as string | null),
          kind,
          SINGLE_GRID,
        ),
        ...(spec.kind === 'numeric' && { scale: spec.std }),
      });
    }
    cache.columns = candidates;
    cache.untouched = untouched;
  }
  if (cache.cloud === undefined) {
    cache.cloud = null;
    if (fitted.length > 1) {
      const step = Math.max(1, Math.floor(fitted.length / CLOUD_ROWS));
      const rows = pipeline.transform(fitted.filter((_, i) => i % step === 0).slice(0, CLOUD_ROWS));
      const apart = rows.map((row, i) => nearestSquared(row, rows, i)).sort((a, b) => a - b);
      cache.cloud = { rows, reach: apart[Math.floor((apart.length - 1) * CLOUD_SHARE)] };
    }
  }
  const cloud = cache.cloud;

  const encode = (rows: Record<string, string>[]) => rows.map((row) => pipeline.transformRow(row));
  const answer = (rows: Record<string, string>[]): Answer[] => {
    const x = encode(rows);
    const both = model.predictWithProba?.(x);
    const labels = both?.labels ?? model.predict(x);
    const proba = both?.proba ?? model.predictProba?.(x);
    return labels.map((label, i) => ({
      label,
      ...(proba && { probability: proba[i][label] ?? 0 }),
    }));
  };
  const [{ label: current }] = answer([values]);

  const result = searchCounterfactuals({
    values,
    columns: cache.columns,
    locked: new Set(locked),
    current,
    target: target === current ? null : target,
    predict: answer,
    ...(cloud && {
      far: (row: Record<string, string>) =>
        nearestSquared(pipeline.transformRow(row), cloud.rows) > cloud.reach,
    }),
  });

  // The other families that answered like this one for the row as it was.
  const [before] = encode([values]);
  const peers = [...artifacts.models.entries()].filter(
    ([key, peer]) =>
      key !== modelKey &&
      key !== 'baseline' &&
      key !== 'ensemble' &&
      peer.predict([before])[0] === current,
  );
  const found = result.found.map((item): ReadCounterfactual => {
    const changed = { ...values };
    for (const change of item.changes) changed[change.column] = change.to;
    const [x] = encode([changed]);
    return {
      ...item,
      followed: {
        by: peers.filter(([, peer]) => peer.predict([x])[0] === item.prediction).length,
        of: peers.length,
      },
    };
  });

  return {
    model: modelKey,
    classes,
    current,
    target: target === current ? null : target,
    found,
    columnsChanged: result.columnsChanged,
    tried: result.tried,
    untouched: cache.untouched ?? [],
  };
}

/**
 * V59: the group audit — does the model treat these groups differently?
 *
 * The segment analysis (`segments.ts`) asks where a model is weakest and
 * looks at every column. This asks another question, about ONE column the
 * user designates: a model can be 80 % accurate everywhere and still say
 * « yes » to 60 % of one group and 30 % of another, or miss twice as many
 * positive cases in one of them. Overall accuracy shows neither.
 *
 * Three rules shape it.
 *
 *  1. THE LAB DOES NOT DECIDE WHAT IS SENSITIVE. The column is chosen by the
 *     user. Guessing « sex » or « age » from a header would be inventing an
 *     intention.
 *  2. THE LAB SHOWS A GAP, IT ISSUES NO VERDICT and corrects nothing: no
 *     legal threshold, no reweighting, no per-group cut. Whether a gap is
 *     acceptable is not a statistical question.
 *  3. A GROUP TOO SMALL IS NOT COMPARED. It is listed with its size instead
 *     of being given a rate that means nothing.
 *
 * The sizes below were measured, not picked. A share estimated on n rows has
 * a 95 % interval about this wide at its worst: ±28 points at n = 8 (the
 * segment analysis's floor), ±20 at 20, ±17 at 30, ±10 at 100. A comparison
 * needs both groups, so the floor is 20 rows; a rate whose own denominator
 * (the positives, for recall) is under 10 is not computed. On the titanic
 * sample that keeps both sexes and the three classes; none of the seven decks
 * reaches it (the largest has 16 test rows), so auditing the deck is refused.
 *
 * For a binary target, each group gets three rates read off its confusion
 * matrix, each with a Wilson interval:
 *  - selection rate: the share predicted positive. The gap between groups is
 *    what the literature calls demographic parity.
 *  - recall: the share of true positives found. Its gap is equal opportunity.
 *  - false-alarm rate: the share of true negatives flagged.
 * A gap is read against the largest group, which gives the narrowest
 * intervals, and carries its own interval (Newcombe's, built from the two
 * Wilson intervals): when it contains zero the gap is inside the noise.
 */
import { inferColumnType, isMissing } from '@/features/ml/data/infer';
import type { Cell } from '@/features/ml/data/types';
import { wilsonInterval } from '@/features/ml/train/conformal';
import { mulberry32 } from '@/features/ml/train/random';
import type { ModelKey } from '@/features/ml/train/types';

/** A group under this many test rows is listed, not compared. */
export const MIN_GROUP_ROWS = 20;
/** A rate whose own denominator is under this is not computed. */
export const MIN_RATE_CASES = 10;
/** Groups compared at most; the rest are counted and said. */
export const MAX_GROUPS = 8;
const BOOTSTRAP_RESAMPLES = 500;
const BOOTSTRAP_SEED_OFFSET = 7919;

export type GroupRateKey = 'selection' | 'recall' | 'falseAlarm' | 'accuracy' | 'bias' | 'mae';

export interface RateEstimate {
  value: number;
  lo: number;
  hi: number;
  /** Rows the rate was computed on: the group, its positives, or its negatives. */
  cases: number;
}

export interface GroupRow {
  value: string;
  rows: number;
  /** Null when the rate's denominator was too small to compute it. */
  rates: Partial<Record<GroupRateKey, RateEstimate | null>>;
}

export interface GroupGap {
  rate: GroupRateKey;
  group: string;
  /** rate(group) − rate(reference). */
  delta: number;
  lo: number;
  hi: number;
  /** The interval excludes zero: the gap is not explained by the draw. */
  real: boolean;
}

export interface GroupAudit {
  model: ModelKey;
  column: string;
  /** Whether the audited column was among the model's features. */
  inFeatures: boolean;
  kind: 'binary' | 'multiclass' | 'regression';
  /** Binary only: the class counted as « positive ». */
  positiveClass?: string;
  /** Binary only: the decision threshold audited, when not the model's default. */
  threshold?: number;
  testRows: number;
  minRows: number;
  minCases: number;
  /** The rates this audit reports, in display order. */
  rates: GroupRateKey[];
  /** The largest group: every gap is read against it. */
  reference: string;
  /** Largest first. */
  groups: GroupRow[];
  gaps: GroupGap[];
  /** Groups set aside for having fewer than `minRows` test rows. */
  small: { value: string; rows: number }[];
  /** Groups large enough but beyond `MAX_GROUPS`. */
  beyondCap: number;
  /** Test rows with no value in the audited column. */
  missingRows: number;
}

/** Fewer than two groups are large enough: there is nothing to compare. */
export interface GroupAuditRefusal {
  model: ModelKey;
  column: string;
  refused: 'too-few-groups';
  minRows: number;
  groups: { value: string; rows: number }[];
}

export type GroupAuditOutcome = GroupAudit | GroupAuditRefusal;

export function isGroupAuditRefusal(outcome: GroupAuditOutcome): outcome is GroupAuditRefusal {
  return 'refused' in outcome;
}

/** A share with its Wilson interval, or null when it rests on too few cases. */
export function shareEstimate(hits: number, cases: number, minCases: number): RateEstimate | null {
  if (cases < minCases) return null;
  const value = hits / cases;
  return { value, ...wilsonInterval(value, cases), cases };
}

/**
 * Newcombe's interval for the difference of two independent shares, built
 * from their Wilson intervals. It behaves near 0 and 1, where the textbook
 * interval runs past the possible values.
 */
export function shareGap(
  a: RateEstimate,
  b: RateEstimate,
): { delta: number; lo: number; hi: number } {
  const delta = a.value - b.value;
  return {
    delta,
    lo: delta - Math.hypot(a.value - a.lo, b.hi - b.value),
    hi: delta + Math.hypot(a.hi - a.value, b.value - b.lo),
  };
}

function percentile(sorted: number[], p: number): number {
  const position = (sorted.length - 1) * p;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

/** Bootstrap means of one group's values, drawn with the audit's own seed. */
function bootstrapMeans(values: number[], rng: () => number): number[] {
  const out: number[] = [];
  for (let b = 0; b < BOOTSTRAP_RESAMPLES; b++) {
    let sum = 0;
    for (let i = 0; i < values.length; i++) sum += values[Math.floor(rng() * values.length)];
    out.push(sum / values.length);
  }
  return out;
}

function intervalOf(draws: number[]): { lo: number; hi: number } {
  const sorted = [...draws].sort((a, b) => a - b);
  return { lo: percentile(sorted, 0.025), hi: percentile(sorted, 0.975) };
}

export interface GroupAuditInput {
  header: string[];
  columns: Cell[][];
  /** Original row of each test position. */
  testIndices: number[];
  testY: number[];
  /** Label per test position (classification) or predicted value (regression). */
  predictions: number[];
  classes: string[];
  isClassification: boolean;
  target: string;
  featureColumns: string[];
  model: ModelKey;
  column: string;
  seed: number;
  /** Binary only: the threshold the predictions were cut at, when not the default. */
  threshold?: number;
}

/**
 * Null when the question does not apply: the column does not exist, is the
 * target, or is not categorical. A refusal when it applies and fewer than two
 * groups are large enough to compare.
 */
export function auditGroups(input: GroupAuditInput): GroupAuditOutcome | null {
  const { header, columns, testIndices, testY, predictions, model, column } = input;
  const index = header.indexOf(column);
  if (index === -1 || column === input.target) return null;
  const type = inferColumnType(column, columns[index]);
  if (type !== 'categorical' && type !== 'boolean') return null;

  const positionsOf = new Map<string, number[]>();
  let missingRows = 0;
  for (let position = 0; position < testIndices.length; position++) {
    const raw = columns[index][testIndices[position]];
    if (isMissing(raw)) {
      missingRows += 1;
      continue;
    }
    const value = (raw as string).trim();
    const bucket = positionsOf.get(value);
    if (bucket) bucket.push(position);
    else positionsOf.set(value, [position]);
  }

  // Largest first; ties by name so the order never depends on the file's.
  const sized = [...positionsOf.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
  );
  const large = sized.filter(([, positions]) => positions.length >= MIN_GROUP_ROWS);
  const small = sized
    .filter(([, positions]) => positions.length < MIN_GROUP_ROWS)
    .map(([value, positions]) => ({ value, rows: positions.length }));
  if (large.length < 2) {
    return {
      model,
      column,
      refused: 'too-few-groups',
      minRows: MIN_GROUP_ROWS,
      groups: sized.map(([value, positions]) => ({ value, rows: positions.length })),
    };
  }
  const kept = large.slice(0, MAX_GROUPS);

  const kind: GroupAudit['kind'] = !input.isClassification
    ? 'regression'
    : input.classes.length === 2
      ? 'binary'
      : 'multiclass';
  const rates: GroupRateKey[] =
    kind === 'binary'
      ? ['selection', 'recall', 'falseAlarm', 'accuracy']
      : kind === 'multiclass'
        ? ['accuracy']
        : ['bias', 'mae'];

  const rng = mulberry32(input.seed + BOOTSTRAP_SEED_OFFSET);
  /** Regression only: the bootstrap draws behind each group's two means. */
  const draws = new Map<string, Partial<Record<GroupRateKey, number[]>>>();

  const groups: GroupRow[] = kept.map(([value, positions]) => {
    const row: GroupRow = { value, rows: positions.length, rates: {} };
    if (kind === 'regression') {
      const signed = positions.map((p) => predictions[p] - testY[p]);
      const absolute = signed.map(Math.abs);
      const biasDraws = bootstrapMeans(signed, rng);
      const maeDraws = bootstrapMeans(absolute, rng);
      draws.set(value, { bias: biasDraws, mae: maeDraws });
      row.rates.bias = { value: mean(signed), ...intervalOf(biasDraws), cases: positions.length };
      row.rates.mae = { value: mean(absolute), ...intervalOf(maeDraws), cases: positions.length };
      return row;
    }
    const correct = positions.filter((p) => predictions[p] === testY[p]).length;
    row.rates.accuracy = shareEstimate(correct, positions.length, MIN_RATE_CASES);
    if (kind === 'binary') {
      const flagged = positions.filter((p) => predictions[p] === 1);
      const positives = positions.filter((p) => testY[p] === 1);
      const negatives = positions.filter((p) => testY[p] === 0);
      row.rates.selection = shareEstimate(flagged.length, positions.length, MIN_RATE_CASES);
      row.rates.recall = shareEstimate(
        positives.filter((p) => predictions[p] === 1).length,
        positives.length,
        MIN_RATE_CASES,
      );
      row.rates.falseAlarm = shareEstimate(
        negatives.filter((p) => predictions[p] === 1).length,
        negatives.length,
        MIN_RATE_CASES,
      );
    }
    return row;
  });

  const reference = groups[0];
  const gaps: GroupGap[] = [];
  for (const group of groups.slice(1)) {
    for (const rate of rates) {
      const own = group.rates[rate];
      const base = reference.rates[rate];
      // A rate missing on either side cannot be compared, and is not.
      if (!own || !base) continue;
      let gap: { delta: number; lo: number; hi: number };
      if (kind === 'regression') {
        const a = draws.get(group.value)![rate]!;
        const b = draws.get(reference.value)![rate]!;
        gap = { delta: own.value - base.value, ...intervalOf(a.map((v, i) => v - b[i])) };
      } else {
        gap = shareGap(own, base);
      }
      gaps.push({ rate, group: group.value, ...gap, real: gap.lo > 0 || gap.hi < 0 });
    }
  }

  return {
    model,
    column,
    inFeatures: input.featureColumns.includes(column),
    kind,
    ...(kind === 'binary' && { positiveClass: input.classes[1] }),
    ...(kind === 'binary' && input.threshold !== undefined && { threshold: input.threshold }),
    testRows: testIndices.length,
    minRows: MIN_GROUP_ROWS,
    minCases: MIN_RATE_CASES,
    rates,
    reference: reference.value,
    groups,
    gaps,
    small,
    beyondCap: large.length - kept.length,
    missingRows,
  };
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** A share is read in percent; a regression error in the target's own unit. */
export function formatRate(rate: GroupRateKey, value: number, lang: string): string {
  return rate === 'bias' || rate === 'mae'
    ? value.toLocaleString(lang, { maximumFractionDigits: 3 })
    : `${(value * 100).toLocaleString(lang, { maximumFractionDigits: 1 })} %`;
}

/** A gap between two shares is read in points, never in percent of a percent. */
export function formatGap(rate: GroupRateKey, value: number, lang: string): string {
  const sign = value > 0 ? '+' : '';
  return rate === 'bias' || rate === 'mae'
    ? `${sign}${value.toLocaleString(lang, { maximumFractionDigits: 3 })}`
    : `${sign}${(value * 100).toLocaleString(lang, { maximumFractionDigits: 1 })}`;
}

/**
 * The audit as sentences, shared by the stored run, the HTML report and the
 * model card so the three cannot drift apart. The caller escapes where it must.
 */
export function groupAuditLines(outcome: GroupAuditOutcome, t: Translate, lang: string): string[] {
  const sizes = (groups: { value: string; rows: number }[]) =>
    groups.map((group) => `${group.value} (${group.rows.toLocaleString(lang)})`).join(', ');
  if (isGroupAuditRefusal(outcome)) {
    return [
      t('ml.lab.groupAudit.refused', {
        column: outcome.column,
        min: outcome.minRows,
        groups: sizes(outcome.groups),
      }),
    ];
  }
  const lines = [
    t(outcome.inFeatures ? 'ml.lab.groupAudit.scopeInFeatures' : 'ml.lab.groupAudit.scopeOutside', {
      column: outcome.column,
      reference: outcome.reference,
    }),
  ];
  if (outcome.kind === 'binary') {
    lines.push(
      outcome.threshold !== undefined
        ? t('ml.lab.groupAudit.decisionThreshold', {
            positive: outcome.positiveClass,
            threshold: outcome.threshold.toLocaleString(lang, { maximumFractionDigits: 2 }),
          })
        : t('ml.lab.groupAudit.decisionDefault', { positive: outcome.positiveClass }),
    );
  }
  for (const group of outcome.groups) {
    const rates = outcome.rates
      .map((rate) => {
        const estimate = group.rates[rate];
        const name = t(`ml.lab.groupAudit.rate.${rate}`);
        return estimate
          ? t('ml.lab.groupAudit.rateValue', {
              name,
              value: formatRate(rate, estimate.value, lang),
              lo: formatRate(rate, estimate.lo, lang),
              hi: formatRate(rate, estimate.hi, lang),
            })
          : t('ml.lab.groupAudit.rateMissing', { name, min: outcome.minCases });
      })
      .join(' ; ');
    lines.push(
      t('ml.lab.groupAudit.groupLine', {
        group: group.value,
        rows: group.rows.toLocaleString(lang),
        rates,
      }),
    );
  }
  const real = outcome.gaps.filter((gap) => gap.real);
  for (const gap of real) {
    lines.push(
      // Two shares differ by points; two errors differ in the target's unit.
      t(
        gap.rate === 'bias' || gap.rate === 'mae'
          ? 'ml.lab.groupAudit.gapRealValue'
          : 'ml.lab.groupAudit.gapReal',
        {
          name: t(`ml.lab.groupAudit.rate.${gap.rate}`),
          group: gap.group,
          reference: outcome.reference,
          delta: formatGap(gap.rate, gap.delta, lang),
          lo: formatGap(gap.rate, gap.lo, lang),
          hi: formatGap(gap.rate, gap.hi, lang),
        },
      ),
    );
  }
  const noise = outcome.gaps.length - real.length;
  if (real.length === 0) lines.push(t('ml.lab.groupAudit.noRealGap'));
  else if (noise > 0) lines.push(t('ml.lab.groupAudit.otherGapsNoise', { count: noise }));
  if (outcome.small.length > 0) {
    lines.push(
      t('ml.lab.groupAudit.small', { min: outcome.minRows, groups: sizes(outcome.small) }),
    );
  }
  if (outcome.beyondCap > 0) {
    lines.push(t('ml.lab.groupAudit.beyondCap', { count: outcome.beyondCap }));
  }
  if (outcome.missingRows > 0) {
    lines.push(t('ml.lab.groupAudit.missing', { rows: outcome.missingRows.toLocaleString(lang) }));
  }
  return lines;
}

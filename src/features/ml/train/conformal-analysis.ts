/**
 * V57: the conformal analysis of one model of a run.
 *
 * WHICH ROWS CALIBRATE. The obvious choice was the validation split, and the
 * wave opened by measuring it: 40 seeds on each demo, coverage read on test.
 * Classification held its targets. Regression did not, for the model the
 * leaderboard crowns: on mpg the winner covered 77.4 % for a target of 80,
 * 88.7 % for 90 and 93.6 % for 95, while the other families sat on target.
 * Picking the winner by validation RMSE is picking the family whose
 * validation residuals are smallest, so those residuals understate its error
 * on new rows. Any subset of validation carries the same selection.
 *
 * The test split is the only set that neither fitted the model nor chose it.
 * So the threshold is calibrated there, and never measured on its own rows:
 * the test is cut into two seeded halves, each half sets a threshold that is
 * then judged on the other. Every test row is judged once, by a threshold it
 * had no part in. Measured the same way: 79.8, 90.2 and 95.2 % on mpg.
 *
 * The threshold handed to new rows (`qHat`) comes from all the test rows —
 * more rows, the same guarantee. The coverage shown is the one measured with
 * the half-thresholds, which is the honest figure: it is what was observed.
 */
import {
  classificationScores,
  classificationSets,
  conformalQuantile,
  minCalibrationRows,
  regressionScores,
  wilsonInterval,
} from '@/features/ml/train/conformal';
import { mulberry32, shuffleInPlace } from '@/features/ml/train/random';
import type { TrainArtifacts } from '@/features/ml/train/trainer';
import type { ModelKey } from '@/features/ml/train/types';

export interface ConformalAnalysis {
  model: ModelKey;
  /** Miscoverage rate asked for: the target coverage is 1 − alpha. */
  alpha: number;
  isClassification: boolean;
  testRows: number;
  /** Rows in the smaller half — what each half-threshold was calibrated on. */
  calibrationRows: number;
  /** The threshold for new rows, from every test row. */
  qHat: number;
  /** Coverage measured across the two halves, each judged by the other. */
  coverage: number;
  coverageLo: number;
  coverageHi: number;
  /** Classification: mean number of classes per set, and shares by size. */
  meanSize?: number;
  sizeShares?: number[];
  /** Regression: every interval is ŷ ± this. */
  halfWidth?: number;
}

/** The lab declines rather than hand out a threshold that guarantees nothing. */
export interface ConformalRefusal {
  model: ModelKey;
  alpha: number;
  refused: 'calibration-too-small';
  /** Rows a half needs at this level, and rows the smaller half has. */
  needed: number;
  available: number;
}

export type ConformalOutcome = ConformalAnalysis | ConformalRefusal;

export function isConformalRefusal(outcome: ConformalOutcome): outcome is ConformalRefusal {
  return 'refused' in outcome;
}

/** Offset keeping the halving draw independent of the split and model seeds. */
const HALVES_SEED_OFFSET = 5701;

/** Two seeded halves of the test positions; the first is the smaller one. */
export function testHalves(rows: number, seed: number): [number[], number[]] {
  const order = shuffleInPlace(
    Array.from({ length: rows }, (_, i) => i),
    mulberry32(seed + HALVES_SEED_OFFSET),
  );
  const cut = Math.floor(rows / 2);
  return [order.slice(0, cut).sort((a, b) => a - b), order.slice(cut).sort((a, b) => a - b)];
}

/**
 * Null when the question does not apply: unknown model, or a classifier that
 * produces no probabilities. A refusal when it applies and cannot be answered
 * honestly at this level.
 */
export function analyzeConformal(
  artifacts: TrainArtifacts,
  modelKey: ModelKey,
  alpha: number,
): ConformalOutcome | null {
  const model = artifacts.models.get(modelKey);
  if (!model) return null;
  const { isClassification, testX, testY } = artifacts;
  if (isClassification && !model.predictProba) return null;

  const proba = isClassification ? model.predictProba!(testX) : null;
  const predictions = isClassification ? null : model.predict(testX);
  const scores = proba ? classificationScores(proba, testY) : regressionScores(predictions!, testY);

  const halves = testHalves(testY.length, artifacts.seed);
  const needed = minCalibrationRows(alpha);
  const available = halves[0].length;
  const refusal: ConformalRefusal = {
    model: modelKey,
    alpha,
    refused: 'calibration-too-small',
    needed,
    available,
  };
  if (available < needed) return refusal;

  // Each half sets a threshold; the other half is judged by it.
  let covered = 0;
  let sizeTotal = 0;
  const sizeCounts: number[] = [];
  for (const [calibration, judged] of [halves, [halves[1], halves[0]]] as const) {
    const threshold = conformalQuantile(
      calibration.map((i) => scores[i]),
      alpha,
    );
    if (threshold === null) return refusal;
    if (proba) {
      const sets = classificationSets(
        judged.map((i) => proba[i]),
        threshold,
      );
      judged.forEach((row, k) => {
        if (sets[k].includes(testY[row])) covered += 1;
        sizeTotal += sets[k].length;
        sizeCounts[sets[k].length] = (sizeCounts[sets[k].length] ?? 0) + 1;
      });
    } else {
      for (const row of judged) if (scores[row] <= threshold + 1e-12) covered += 1;
    }
  }

  const qHat = conformalQuantile(scores, alpha);
  if (qHat === null) return refusal;

  const rows = testY.length;
  const coverage = covered / rows;
  const interval = wilsonInterval(coverage, rows);
  return {
    model: modelKey,
    alpha,
    isClassification,
    testRows: rows,
    calibrationRows: available,
    qHat,
    coverage,
    coverageLo: interval.lo,
    coverageHi: interval.hi,
    ...(proba
      ? {
          meanSize: sizeTotal / rows,
          sizeShares: Array.from(
            { length: sizeCounts.length },
            (_, k) => (sizeCounts[k] ?? 0) / rows,
          ),
        }
      : { halfWidth: qHat }),
  };
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The analysis as sentences, shared by the panel, the stored run and the HTML
 * report so the three cannot drift apart. The caller escapes where it must.
 */
export function conformalLines(outcome: ConformalOutcome, t: Translate, lang: string): string[] {
  const pct = (share: number, digits = 1) =>
    (share * 100).toLocaleString(lang, { maximumFractionDigits: digits });
  const target = pct(1 - outcome.alpha, 0);
  if (isConformalRefusal(outcome)) {
    return [
      t('ml.lab.conformal.refused', {
        target,
        needed: outcome.needed,
        available: outcome.available,
      }),
    ];
  }
  const lines = [
    t('ml.lab.conformal.coverageLine', {
      coverage: pct(outcome.coverage),
      lo: pct(outcome.coverageLo),
      hi: pct(outcome.coverageHi),
      target,
      rows: outcome.testRows.toLocaleString(lang),
    }),
  ];
  if (outcome.isClassification) {
    const shares = outcome.sizeShares ?? [];
    const several = shares.slice(2).reduce((a, b) => a + b, 0);
    lines.push(
      t('ml.lab.conformal.setsLine', {
        mean: (outcome.meanSize ?? Number.NaN).toLocaleString(lang, { maximumFractionDigits: 2 }),
        single: pct(shares[1] ?? 0),
        several: pct(several),
        empty: pct(shares[0] ?? 0),
      }),
      t('ml.lab.conformal.thresholdLine', {
        floor: Math.max(0, 1 - outcome.qHat).toLocaleString(lang, { maximumFractionDigits: 3 }),
      }),
    );
  } else {
    lines.push(
      t('ml.lab.conformal.intervalLine', {
        half: (outcome.halfWidth ?? outcome.qHat).toLocaleString(lang, {
          maximumFractionDigits: 3,
        }),
      }),
    );
  }
  lines.push(t('ml.lab.conformal.howLine', { rows: outcome.calibrationRows.toLocaleString(lang) }));
  return lines;
}

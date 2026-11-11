import { describe, expect, it } from 'vitest';
import reference from '../../../../tests/golden/sklearn-reference.json';
import {
  classificationScores,
  classificationSets,
  conformalQuantile,
  evaluateIntervals,
  evaluateSets,
  minCalibrationRows,
  regressionScores,
  wilsonInterval,
} from '@/features/ml/train/conformal';
import {
  analyzeConformal,
  isConformalRefusal,
  testHalves,
  type ConformalAnalysis,
} from '@/features/ml/train/conformal-analysis';
import { mulberry32 } from '@/features/ml/train/random';
import type { TrainedModel } from '@/features/ml/train/models';
import type { TrainArtifacts } from '@/features/ml/train/trainer';

// V57: split conformal prediction. The arithmetic is checked against an
// independent numpy reference; the guarantee is checked the only way a
// guarantee can be, by drawing many datasets and counting.

const golden = reference.conformal;

describe('the conformal quantile', () => {
  it('is the ⌈(n+1)(1−α)⌉-th smallest score', () => {
    const scores = [0.5, 0.1, 0.9, 0.3, 0.7, 0.2, 0.8, 0.4, 0.6];
    // n = 9, α = 0.2 → rank ⌈8⌉ = 8 → 0.8.
    expect(conformalQuantile(scores, 0.2)).toBe(0.8);
    // α = 0.1 → rank ⌈9⌉ = 9 → the largest.
    expect(conformalQuantile(scores, 0.1)).toBe(0.9);
  });

  it('does not let a float hair push the rank one too far', () => {
    // (9 + 1) × 0.9 is 9.000000000000002 in floating point; the rank is 9.
    const scores = Array.from({ length: 9 }, (_, i) => i + 1);
    expect(conformalQuantile(scores, 0.1)).toBe(9);
  });

  it('refuses when there are too few scores for the level', () => {
    expect(conformalQuantile(golden.tooFew.scores, golden.tooFew.alpha)).toBeNull();
    expect(golden.tooFew.quantile).toBeNull();
    expect(conformalQuantile([], 0.1)).toBeNull();
    expect(conformalQuantile([1, 2, 3], 0)).toBeNull();
    expect(conformalQuantile([1, 2, 3], 1)).toBeNull();
  });

  it('names the smallest calibration set each level can use', () => {
    expect(minCalibrationRows(0.2)).toBe(4);
    expect(minCalibrationRows(0.1)).toBe(9);
    expect(minCalibrationRows(0.05)).toBe(19);
    // One row fewer is refused, that many is accepted.
    for (const alpha of [0.2, 0.1, 0.05]) {
      const n = minCalibrationRows(alpha);
      expect(conformalQuantile(new Array<number>(n).fill(0.5), alpha)).toBe(0.5);
      expect(conformalQuantile(new Array<number>(n - 1).fill(0.5), alpha)).toBeNull();
    }
  });

  it('does not reorder the scores it was given', () => {
    const scores = [0.9, 0.1, 0.5, 0.3, 0.7];
    conformalQuantile(scores, 0.2);
    expect(scores).toEqual([0.9, 0.1, 0.5, 0.3, 0.7]);
  });
});

describe('against the numpy reference', () => {
  it.each(golden.levels)('classification sets at α = $alpha', (level) => {
    const scores = classificationScores(golden.calibrationProbabilities, golden.calibrationLabels);
    const qHat = conformalQuantile(scores, level.alpha)!;
    expect(qHat).toBeCloseTo(level.classificationQuantile, 12);
    const sets = classificationSets(golden.testProbabilities, qHat);
    expect(sets).toEqual(level.sets);
    const metrics = evaluateSets(sets, golden.testLabels);
    expect(metrics.coverage).toBeCloseTo(level.setCoverage, 12);
    expect(metrics.meanSize).toBeCloseTo(level.meanSetSize, 12);
  });

  it.each(golden.levels)('regression intervals at α = $alpha', (level) => {
    const scores = regressionScores(golden.calibrationPredictions, golden.calibrationTargets);
    const qHat = conformalQuantile(scores, level.alpha)!;
    expect(qHat).toBeCloseTo(level.regressionQuantile, 12);
    const metrics = evaluateIntervals(golden.testPredictions, golden.testTargets, qHat);
    expect(metrics.coverage).toBeCloseTo(level.intervalCoverage, 12);
    expect(metrics.halfWidth).toBe(qHat);
  });
});

describe('sets and intervals', () => {
  it('keeps every class at or above 1 − q̂, the one on the threshold included', () => {
    const sets = classificationSets(
      [
        [0.7, 0.2, 0.1],
        [0.4, 0.3, 0.3],
        [0.2, 0.2, 0.6],
      ],
      0.7,
    );
    // Threshold 0.3: classes sitting exactly on it are in.
    expect(sets).toEqual([[0], [0, 1, 2], [2]]);
  });

  it('can answer with an empty set, and counts it', () => {
    const sets = classificationSets([[0.4, 0.3, 0.3]], 0.5);
    expect(sets).toEqual([[]]);
    const metrics = evaluateSets(sets, [0]);
    expect(metrics.coverage).toBe(0);
    expect(metrics.sizeShares).toEqual([1]);
  });

  it('reports the share of sets of each size', () => {
    const metrics = evaluateSets([[0], [0, 1], [1], [0, 1, 2]], [0, 1, 0, 2]);
    expect(metrics.coverage).toBe(0.75);
    expect(metrics.meanSize).toBe(1.75);
    expect(metrics.sizeShares).toEqual([0, 0.5, 0.25, 0.25]);
  });

  it('measures nothing on no rows rather than inventing a coverage', () => {
    expect(evaluateSets([], []).coverage).toBeNaN();
    expect(evaluateIntervals([], [], 1).coverage).toBeNaN();
    expect(wilsonInterval(Number.NaN, 0).lo).toBeNaN();
  });

  it('brackets a measured share with a Wilson interval', () => {
    const { lo, hi } = wilsonInterval(0.9, 100);
    expect(lo).toBeCloseTo(0.8256, 3);
    expect(hi).toBeCloseTo(0.9448, 3);
    expect(wilsonInterval(1, 20).hi).toBe(1);
  });
});

describe('the guarantee, counted', () => {
  // Exchangeable draws: calibration and new scores come from the same source.
  it.each([0.2, 0.1, 0.05])('covers at least 1 − α on average (α = %s)', (alpha) => {
    const rng = mulberry32(2026);
    const trials = 400;
    const n = 60;
    let covered = 0;
    let total = 0;
    for (let trial = 0; trial < trials; trial++) {
      const calibration = Array.from({ length: n }, () => rng());
      const qHat = conformalQuantile(calibration, alpha)!;
      for (let k = 0; k < 20; k++) {
        if (rng() <= qHat) covered += 1;
        total += 1;
      }
    }
    const coverage = covered / total;
    expect(coverage).toBeGreaterThanOrEqual(1 - alpha - 0.01);
    // And not wildly above: the method is tight, 1 − α + 1/(n+1) at most.
    expect(coverage).toBeLessThanOrEqual(1 - alpha + 1 / (n + 1) + 0.01);
  });
});

/** A model whose single feature already is the answer. */
function artifactsOf(
  model: TrainedModel,
  testX: number[][],
  testY: number[],
  isClassification: boolean,
): TrainArtifacts {
  return {
    models: new Map([['gbdt', model]]),
    pipeline: {} as TrainArtifacts['pipeline'],
    validationX: [],
    validationY: [],
    testX,
    testY,
    testIndices: testY.map((_, i) => i),
    classes: isClassification ? ['a', 'b', 'c'] : [],
    isClassification,
    seed: 42,
  };
}

describe('the analysis of a run (V57)', () => {
  const rng = mulberry32(7);
  const rows = 200;
  // A classifier that is right about 80 % of the time, and says so.
  const labels = Array.from({ length: rows }, (_, i) => i % 3);
  const classifier = {
    predict: (x: number[][]) => x.map((row) => row.indexOf(Math.max(...row))),
    predictProba: (x: number[][]) => x,
  } as unknown as TrainedModel;
  const proba = labels.map((label) => {
    const confident = rng() < 0.8;
    const top = confident ? label : (label + 1) % 3;
    const p = 0.5 + rng() * 0.4;
    const rest = (1 - p) / 2;
    return [0, 1, 2].map((k) => (k === top ? p : rest));
  });
  const classification = artifactsOf(classifier, proba, labels, true);

  const targets = Array.from({ length: rows }, () => 10 + rng() * 20);
  const noisy = targets.map((target) => target + (rng() - 0.5) * 6);
  const regressor = { predict: (x: number[][]) => x.map((row) => row[0]) } as TrainedModel;
  const regression = artifactsOf(
    regressor,
    noisy.map((value) => [value]),
    targets,
    false,
  );

  it('cuts the test into two halves that share no row and lose none', () => {
    const [a, b] = testHalves(31, 42);
    expect(a).toHaveLength(15);
    expect(b).toHaveLength(16);
    expect([...a, ...b].sort((x, y) => x - y)).toEqual(Array.from({ length: 31 }, (_, i) => i));
    expect(testHalves(31, 42)).toEqual([a, b]);
    expect(testHalves(31, 43)).not.toEqual([a, b]);
  });

  it('measures the coverage of a classifier beside its target', () => {
    const outcome = analyzeConformal(classification, 'gbdt', 0.1) as ConformalAnalysis;
    expect(isConformalRefusal(outcome)).toBe(false);
    expect(outcome.testRows).toBe(rows);
    expect(outcome.calibrationRows).toBe(100);
    expect(outcome.coverage).toBeGreaterThan(0.84);
    expect(outcome.coverage).toBeLessThan(0.97);
    expect(outcome.coverageLo).toBeLessThan(outcome.coverage);
    expect(outcome.coverageHi).toBeGreaterThan(outcome.coverage);
    expect(outcome.meanSize).toBeGreaterThan(1);
    expect(outcome.sizeShares!.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(outcome.halfWidth).toBeUndefined();
  });

  it('widens the sets when more coverage is asked', () => {
    const at80 = analyzeConformal(classification, 'gbdt', 0.2) as ConformalAnalysis;
    const at95 = analyzeConformal(classification, 'gbdt', 0.05) as ConformalAnalysis;
    expect(at95.qHat).toBeGreaterThanOrEqual(at80.qHat);
    expect(at95.meanSize!).toBeGreaterThanOrEqual(at80.meanSize!);
    expect(at95.coverage).toBeGreaterThanOrEqual(at80.coverage);
  });

  it('gives a regressor one half-width, and the coverage measured with it', () => {
    const outcome = analyzeConformal(regression, 'gbdt', 0.1) as ConformalAnalysis;
    expect(outcome.isClassification).toBe(false);
    // Residuals are uniform on ±3: the 90 % half-width sits near 2.7.
    expect(outcome.halfWidth).toBeGreaterThan(2.4);
    expect(outcome.halfWidth).toBeLessThan(3);
    expect(outcome.halfWidth).toBe(outcome.qHat);
    expect(outcome.coverage).toBeGreaterThan(0.84);
    expect(outcome.meanSize).toBeUndefined();
  });

  it('is the same analysis twice: nothing in it is drawn at random', () => {
    expect(analyzeConformal(regression, 'gbdt', 0.1)).toEqual(
      analyzeConformal(regression, 'gbdt', 0.1),
    );
  });

  it('refuses a level the test split cannot carry, with the numbers', () => {
    const small = artifactsOf(
      regressor,
      noisy.slice(0, 30).map((v) => [v]),
      targets.slice(0, 30),
      false,
    );
    // 15 rows per half: enough for 90 % (9), not for 95 % (19).
    expect(isConformalRefusal(analyzeConformal(small, 'gbdt', 0.1)!)).toBe(false);
    expect(analyzeConformal(small, 'gbdt', 0.05)).toEqual({
      model: 'gbdt',
      alpha: 0.05,
      refused: 'calibration-too-small',
      needed: 19,
      available: 15,
    });
  });

  it('has no answer for a model it does not know or a classifier with no probabilities', () => {
    expect(analyzeConformal(classification, 'forest', 0.1)).toBeNull();
    const labelsOnly = { predict: classifier.predict } as TrainedModel;
    expect(analyzeConformal(artifactsOf(labelsOnly, proba, labels, true), 'gbdt', 0.1)).toBeNull();
  });
});

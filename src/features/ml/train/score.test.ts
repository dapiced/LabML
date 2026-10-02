import { describe, expect, it } from 'vitest';
import { profileColumn } from '@/features/ml/data/profile';
import { requiredColumns, scoreBatch, scoreRows } from '@/features/ml/train/score';
import { runTraining, type TrainArtifacts } from '@/features/ml/train/trainer';
import type { Cell } from '@/features/ml/data/types';

const N = 120;

async function trainToy(regression = false): Promise<TrainArtifacts> {
  const data: Record<string, Cell[]> = {
    f1: Array.from({ length: N }, (_, i) => String(i)),
    label: regression
      ? Array.from({ length: N }, (_, i) => String(2 * i + 1))
      : Array.from({ length: N }, (_, i) => (i < N / 2 ? 'no' : 'yes')),
  };
  const columns = new Map(Object.entries(data));
  const profiles = Object.entries(data).map(([name, values]) => profileColumn(name, values));
  const outcome = await runTraining(
    columns,
    profiles,
    { target: 'label', features: ['f1'], seed: 42, testRatio: 0.2 },
    { onModelStart: () => undefined, onModelResult: () => undefined, isCancelled: () => false },
  );
  return outcome!.artifacts;
}

describe('scoreBatch', () => {
  it('scores a labeled batch and compares against the test metrics', async () => {
    const artifacts = await trainToy();
    const header = ['f1', 'label', 'extra'];
    const cols: Cell[][] = [
      ['10', '20', '100', '110'],
      ['no', 'no', 'yes', 'yes'],
      ['a', 'b', 'c', 'd'],
    ];
    const score = scoreBatch(artifacts, 'logistic', 'label', 'field.csv', header, cols);
    expect(score.rowCount).toBe(4);
    expect(score.hasTarget).toBe(true);
    expect(score.labeledRows).toBe(4);
    expect(score.metrics?.accuracy).toBe(1);
    expect(score.testMetrics.accuracy).toBeGreaterThan(0.9);
    expect(score.preview.map((p) => p.predicted)).toEqual(['no', 'no', 'yes', 'yes']);
    expect(score.preview[0].actual).toBe('no');
    expect(score.preview[0].proba).toBeGreaterThan(0.5);
    // Full CSV: original columns preserved, prediction and probabilities added.
    const lines = score.csv.split('\n');
    expect(lines[0]).toBe('f1,label,extra,predicted,p_no,p_yes');
    expect(lines).toHaveLength(5);
    expect(lines[1].startsWith('10,no,a,no,')).toBe(true);
  });

  it('rejects a batch missing a feature column, naming it', async () => {
    const artifacts = await trainToy();
    expect(requiredColumns(artifacts)).toEqual(['f1']);
    expect(() => scoreBatch(artifacts, 'logistic', 'label', 'bad.csv', ['other'], [['1']])).toThrow(
      'missing-columns:f1',
    );
  });

  it('predicts unlabeled batches without metrics', async () => {
    const artifacts = await trainToy();
    const score = scoreBatch(artifacts, 'logistic', 'label', 'new.csv', ['f1'], [['5', '115']]);
    expect(score.hasTarget).toBe(false);
    expect(score.metrics).toBeUndefined();
    expect(score.preview.map((p) => p.predicted)).toEqual(['no', 'yes']);
    expect(score.preview[0].actual).toBeUndefined();
  });

  it('counts labels unseen in training and keeps them out of the metrics', async () => {
    const artifacts = await trainToy();
    const score = scoreBatch(
      artifacts,
      'logistic',
      'label',
      'field.csv',
      ['f1', 'label'],
      [
        ['10', '110', '60'],
        ['no', 'yes', 'maybe'],
      ],
    );
    expect(score.unknownLabels).toBe(1);
    expect(score.labeledRows).toBe(2);
    expect(score.metrics?.accuracy).toBe(1);
    // The unseen-label row is still predicted in the CSV.
    expect(score.csv.split('\n')).toHaveLength(4);
  });

  it('scores regression batches with rmse/mae/r2 on parseable targets only', async () => {
    const artifacts = await trainToy(true);
    const score = scoreBatch(
      artifacts,
      'linear',
      'label',
      'field.csv',
      ['f1', 'label'],
      [
        ['10', '50', '90'],
        ['21', '101', 'not-a-number'],
      ],
    );
    expect(score.hasTarget).toBe(true);
    expect(score.labeledRows).toBe(2);
    expect(score.metrics?.rmse).toBeLessThan(1);
    expect(score.metrics?.r2).toBeGreaterThan(0.99);
  });

  it('applies a frozen multiclass policy while preserving raw predictions', () => {
    const probabilities = [
      [0.8, 0.1, 0.1],
      [0.4, 0.35, 0.25],
    ];
    const score = scoreRows(
      {
        model: {
          predict: () => [0, 0],
          predictProba: () => probabilities,
        },
        specs: [{ kind: 'numeric', name: 'feature', median: 0, mean: 0, std: 1 }],
        transformRow: (row) => [Number(row.feature)],
        classes: ['a', 'b', 'c'],
        isClassification: true,
        decisionPolicy: { thresholds: [0.6, 0.6, 0.6] },
      },
      'logistic',
      { accuracy: 0.7 },
      'label',
      'field.csv',
      ['feature', 'label'],
      [
        ['1', '2'],
        ['a', 'b'],
      ],
    );

    expect(score.preview.map((row) => row.decisionStatus)).toEqual(['decided', 'abstained']);
    expect(score.preview.map((row) => row.predicted)).toEqual(['a', 'a']);
    expect(score.csv.split('\n')[0]).toBe(
      'feature,label,predicted,p_a,p_b,p_c,policy_decision,decision_status',
    );
    expect(score.decisionSummary?.coverage).toBe(0.5);
    expect(score.decision?.coverage).toBe(0.5);
  });

  it('reports policy coverage for an unlabeled production batch', () => {
    const score = scoreRows(
      {
        model: {
          predict: () => [0, 0],
          predictProba: () => [
            [0.8, 0.1, 0.1],
            [0.4, 0.35, 0.25],
          ],
        },
        specs: [{ kind: 'numeric', name: 'feature', median: 0, mean: 0, std: 1 }],
        transformRow: (row) => [Number(row.feature)],
        classes: ['a', 'b', 'c'],
        isClassification: true,
        decisionPolicy: { thresholds: [0.6, 0.6, 0.6] },
      },
      'logistic',
      {},
      'label',
      'production.csv',
      ['feature'],
      [['1', '2']],
    );

    expect(score.decisionSummary).toEqual({ rows: 2, decided: 1, abstained: 1, coverage: 0.5 });
    expect(score.decision).toBeUndefined();
  });

  it('is deterministic for the same input', async () => {
    const artifacts = await trainToy();
    const batch = (): [string[], Cell[][]] => [
      ['f1', 'label'],
      [
        ['10', '110'],
        ['no', 'yes'],
      ],
    ];
    const a = scoreBatch(artifacts, 'logistic', 'label', 'field.csv', ...batch());
    const b = scoreBatch(artifacts, 'logistic', 'label', 'field.csv', ...batch());
    expect(a.csv).toBe(b.csv);
    expect(a.metrics).toEqual(b.metrics);
  });
});

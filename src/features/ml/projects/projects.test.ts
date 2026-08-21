import { compressToEncodedURIComponent } from 'lz-string';
import { describe, expect, it } from 'vitest';
import { profileColumn } from '@/features/ml/data/profile';
import { buildPlainRead, buildReportHtml } from '@/features/ml/projects/report';
import { decodeShareFragment, encodeShareFragment } from '@/features/ml/projects/share';
import { computeInsights } from '@/features/ml/train/insights';
import { runTraining } from '@/features/ml/train/trainer';
import type { Cell } from '@/features/ml/data/types';
import type { RunArtifacts, RunRecord } from '@/features/ml/projects/types';

const fakeT = (key: string, options?: Record<string, unknown>) =>
  options ? `${key}(${Object.values(options).join('|')})` : key;

async function makeRecord(): Promise<RunRecord> {
  const N = 120;
  const data: Record<string, Cell[]> = {
    f1: Array.from({ length: N }, (_, i) => String(i)),
    label: Array.from({ length: N }, (_, i) => (i < N / 2 ? 'no' : 'yes')),
  };
  const columns = new Map(Object.entries(data));
  const profiles = Object.entries(data).map(([name, values]) => profileColumn(name, values));
  const results: RunRecord['results'] = [];
  const outcome = await runTraining(
    columns,
    profiles,
    { target: 'label', features: ['f1'], seed: 42, testRatio: 0.2 },
    {
      onModelStart: () => undefined,
      onModelResult: (r) => results.push(r),
      isCancelled: () => false,
    },
  );
  return {
    name: 'demo · label',
    createdAt: 1_760_000_000_000,
    dataset: { name: 'demo.csv', rowCount: N, columnCount: 2 },
    target: 'label',
    taskType: 'binary',
    seed: 42,
    results,
    summary: outcome!.summary,
    insights: computeInsights(outcome!.artifacts, 'logistic'),
  };
}

/** Small hand-built artifacts of every kind, with oversized point clouds. */
function makeArtifacts(): RunArtifacts {
  return {
    tuning: {
      model: 'knn',
      isClassification: true,
      folds: 3,
      budget: 6,
      bestParams: { k: 5 },
      bestCv: 0.94,
      defaultPrimary: 0.9,
      tunedPrimary: 0.95,
      tunedMetrics: { accuracy: 0.95 },
      trials: [{ params: { k: 5 }, cvScore: 0.94 }],
      totalMs: 120,
    },
    explanation: {
      model: 'logistic',
      targetClass: 'yes',
      usedProba: true,
      baseline: 0.5,
      prediction: 0.9,
      contributions: [{ column: 'f1', value: 0.4 }],
      permutations: 8,
      references: 24,
    },
    exploration: {
      k: 2,
      silhouette: 0.6,
      tried: [
        { k: 2, silhouette: 0.6 },
        { k: 3, silhouette: 0.4 },
      ],
      points: Array.from({ length: 500 }, (_, i) => [i, -i, i % 2] as [number, number, number]),
      explained: [0.7, 0.2],
      clusters: [
        {
          id: 0,
          size: 60,
          share: 0.5,
          traits: [{ kind: 'numeric', column: 'f1', clusterMean: 30, overallMean: 60 }],
        },
        {
          id: 1,
          size: 60,
          share: 0.5,
          traits: [
            { kind: 'categorical', column: 'label', value: 'yes', share: 0.9, overallShare: 0.5 },
          ],
        },
      ],
      featureColumns: ['f1'],
      rowsUsed: 120,
      seed: 42,
    },
    threshold: {
      model: 'logistic',
      positiveClass: 'yes',
      positiveRate: 0.08,
      averagePrecision: 0.74,
      brier: 0.06,
      prPoints: [
        { recall: 0.5, precision: 1, threshold: 0.9 },
        { recall: 1, precision: 0.6, threshold: 0.3 },
      ],
      calibrationBins: [{ meanPredicted: 0.1, observedRate: 0.08, count: 50 }],
      chosen: {
        threshold: 0.3,
        tp: 8,
        fp: 5,
        fn: 0,
        tn: 87,
        precision: 0.615,
        recall: 1,
        f1: 0.762,
        accuracy: 0.95,
        cost: 5,
        costFp: 1,
        costFn: 10,
      },
    },
    uncertainty: {
      isClassification: true,
      metricLabel: 'accuracy',
      testRows: 24,
      resamples: 1000,
      seed: 42,
      intervals: [
        { model: 'logistic', point: 0.92, lo: 0.83, hi: 0.98 },
        { model: 'baseline', point: 0.5, lo: 0.35, hi: 0.65 },
      ],
      verdict: {
        winner: 'logistic',
        against: 'baseline',
        delta: 0.42,
        lo: 0.21,
        hi: 0.58,
        winShare: 0.998,
        decisive: true,
      },
    },
    segments: {
      model: 'logistic',
      isClassification: true,
      metricLabel: 'accuracy',
      overall: 0.9,
      testRows: 24,
      minRows: 8,
      columns: [
        {
          column: 'group',
          inFeatures: false,
          segments: [
            { value: 'A', rows: 10, metric: 0.7, delta: -0.2 },
            { value: 'B', rows: 14, metric: 1, delta: 0.1 },
          ],
          spread: 0.2,
          smallSegments: 1,
        },
      ],
    },
    batchScore: {
      fileName: 'field.csv',
      model: 'logistic',
      rowCount: 30,
      hasTarget: true,
      labeledRows: 30,
      unknownLabels: 0,
      metrics: { accuracy: 0.9, f1: 0.89 },
      testMetrics: { accuracy: 0.95, f1: 0.94 },
    },
    forecast: {
      dateColumn: 'date',
      valueColumn: 'y',
      freq: 'monthly',
      seasonalPeriod: 12,
      points: Array.from({ length: 200 }, (_, i) => ({ t: i, y: i })),
      totalPoints: 200,
      dropped: 0,
      holdout: 20,
      methods: [
        { key: 'holtWinters', params: { alpha: 0.3 }, mae: 1.2, rmse: 1.5 },
        { key: 'naive', params: {}, mae: 2.4, rmse: 3 },
      ],
      winner: { key: 'holtWinters', params: { alpha: 0.3 }, mae: 1.2, rmse: 1.5 },
      naiveMae: 2.4,
      forecast: [{ t: 201, yhat: 200, lo: 190, hi: 210 }],
    },
  };
}

describe('share link codec', () => {
  it('round-trips a run record through the compressed fragment', async () => {
    const record = await makeRecord();
    const fragment = encodeShareFragment(record);
    expect(fragment).not.toContain('#');
    const decoded = decodeShareFragment(fragment)!;
    expect(decoded).not.toBeNull();
    expect(decoded.v).toBe(2);
    expect(decoded.name).toBe(record.name);
    expect(decoded.results.map((r) => [r.key, r.primary])).toEqual(
      record.results.map((r) => [r.key, r.primary]),
    );
    expect(decoded.insights.confusion).toEqual(record.insights.confusion);
  });

  it('rejects garbage fragments without throwing', () => {
    expect(decodeShareFragment('definitely-not-a-payload')).toBeNull();
    expect(decodeShareFragment('')).toBeNull();
  });

  it('carries run artifacts, with point clouds trimmed for the URL', async () => {
    const record = { ...(await makeRecord()), artifacts: makeArtifacts() };
    const decoded = decodeShareFragment(encodeShareFragment(record))!;
    expect(decoded.artifacts?.tuning?.bestParams).toEqual({ k: 5 });
    expect(decoded.artifacts?.explanation?.contributions).toEqual([{ column: 'f1', value: 0.4 }]);
    expect(decoded.artifacts?.exploration?.clusters).toHaveLength(2);
    expect(decoded.artifacts?.forecast?.winner.key).toBe('holtWinters');
    expect(decoded.artifacts?.batchScore?.fileName).toBe('field.csv');
    expect(decoded.artifacts?.threshold?.chosen.threshold).toBe(0.3);
    expect(decoded.artifacts?.segments?.columns[0].segments[0].value).toBe('A');
    expect(decoded.artifacts?.uncertainty?.verdict?.decisive).toBe(true);
    // Oversized point clouds are downsampled / tailed, never dropped.
    expect(decoded.artifacts!.exploration!.points.length).toBeLessThanOrEqual(121);
    expect(decoded.artifacts!.exploration!.points.length).toBeGreaterThan(50);
    expect(decoded.artifacts!.forecast!.points).toHaveLength(60);
    // The stored record itself keeps everything.
    expect(record.artifacts.exploration!.points).toHaveLength(500);
  });

  it('still decodes v1 links made before artifacts existed', async () => {
    const record = await makeRecord();
    const v1 = compressToEncodedURIComponent(
      JSON.stringify({
        v: 1,
        name: record.name,
        createdAt: record.createdAt,
        dataset: record.dataset,
        target: record.target,
        taskType: record.taskType,
        seed: record.seed,
        results: record.results,
        summary: record.summary,
        insights: record.insights,
      }),
    );
    const decoded = decodeShareFragment(v1)!;
    expect(decoded).not.toBeNull();
    expect(decoded.v).toBe(1);
    expect(decoded.artifacts).toBeUndefined();
    expect(decodeShareFragment(compressToEncodedURIComponent('{"v":3}'))).toBeNull();
  });
});

describe('report generation', () => {
  it('builds a plain read and a self-contained HTML report', async () => {
    const record = await makeRecord();
    const read = buildPlainRead(record, fakeT, 'en');
    expect(read).toContain('ml.lab.insights.readAccuracy');
    expect(read).toContain('ml.lab.insights.readDrivers(f1)');

    const html = buildReportHtml(record, fakeT, 'en');
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('ml.lab.models.logistic');
    expect(html).toContain('<table');
    expect(html).toContain('ml.lab.reportFooter');
    expect(html).not.toContain('<script');
    // No artifacts → no artifact sections.
    expect(html).not.toContain('ml.lab.tuning.title');
    expect(html).not.toContain('ml.lab.forecast.title');
  });

  it('adds one section per attached artifact', async () => {
    const record = { ...(await makeRecord()), artifacts: makeArtifacts() };
    const html = buildReportHtml(record, fakeT, 'en');
    expect(html).toContain('ml.lab.tuning.title');
    expect(html).toContain('k = 5');
    expect(html).toContain('ml.lab.insights.explainTitleClass(yes)');
    expect(html).toContain('ml.lab.explore.title');
    expect(html).toContain('ml.lab.explore.traitNumeric(f1|30|60)');
    expect(html).toContain('ml.lab.forecast.title');
    expect(html).toContain('ml.lab.forecast.methods.holtWinters');
    expect(html).toContain('ml.lab.batch.title');
    expect(html).toContain('field.csv');
    expect(html).toContain('ml.lab.threshold.title');
    expect(html).toContain('0.30');
    expect(html).toContain('ml.lab.segments.title');
    expect(html).toContain('-0.200');
    expect(html).toContain('ml.lab.uncertainty.title');
    expect(html).toContain('[0.830 ; 0.980]');
    expect(html).toContain('ml.lab.uncertainty.verdictReal');
    expect(html).not.toContain('<script');
  });
});

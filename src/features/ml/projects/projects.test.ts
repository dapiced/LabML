import { describe, expect, it } from 'vitest';
import { profileColumn } from '@/features/ml/data/profile';
import { buildPlainRead, buildReportHtml } from '@/features/ml/projects/report';
import { decodeShareFragment, encodeShareFragment } from '@/features/ml/projects/share';
import { computeInsights } from '@/features/ml/train/insights';
import { runTraining } from '@/features/ml/train/trainer';
import type { Cell } from '@/features/ml/data/types';
import type { RunRecord } from '@/features/ml/projects/types';

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

describe('share link codec', () => {
  it('round-trips a run record through the compressed fragment', async () => {
    const record = await makeRecord();
    const fragment = encodeShareFragment(record);
    expect(fragment).not.toContain('#');
    const decoded = decodeShareFragment(fragment)!;
    expect(decoded).not.toBeNull();
    expect(decoded.v).toBe(1);
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
  });
});

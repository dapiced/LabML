import { describe, expect, it } from 'vitest';
import { ANOMALY_THRESHOLD, isolationScores } from './isolation';
import type { Cell } from '@/features/ml/data/types';

/** 60 ordinary rows in a tight 2D cluster + 2 planted multivariate outliers. */
function planted(): { header: string[]; columns: Cell[][] } {
  const a: Cell[] = [];
  const b: Cell[] = [];
  for (let i = 0; i < 60; i++) {
    a.push(String(10 + (i % 5)));
    b.push(String(20 + ((i * 3) % 7)));
  }
  // Each value alone is not extreme in a Tukey sense as combined outliers go far.
  a.push('90', '-40');
  b.push('95', '-50');
  return { header: ['a', 'b'], columns: [a, b] };
}

describe('isolationScores', () => {
  it('flags planted multivariate outliers above the threshold', () => {
    const { header, columns } = planted();
    const result = isolationScores(header, columns)!;
    expect(result.featureColumns).toEqual(['a', 'b']);
    expect(result.scores).toHaveLength(62);
    for (const score of result.scores) {
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(1);
    }
    // The two planted rows isolate fast; the cluster does not.
    expect(result.scores[60]).toBeGreaterThan(ANOMALY_THRESHOLD);
    expect(result.scores[61]).toBeGreaterThan(ANOMALY_THRESHOLD);
    const clusterMax = Math.max(...result.scores.slice(0, 60));
    expect(clusterMax).toBeLessThan(result.scores[60]);
    expect(clusterMax).toBeLessThan(ANOMALY_THRESHOLD);
  });

  it('is deterministic for the same data and seed', () => {
    const { header, columns } = planted();
    const a = isolationScores(header, columns)!;
    const b = isolationScores(header, columns)!;
    expect(a.scores).toEqual(b.scores);
  });

  it('reads missing numeric cells as the column median', () => {
    const { header, columns } = planted();
    (columns[0] as Cell[])[5] = null;
    (columns[1] as Cell[])[6] = 'NA';
    const result = isolationScores(header, columns)!;
    // Median-filled rows sit inside the cluster: still ordinary.
    expect(result.scores[5]).toBeLessThan(ANOMALY_THRESHOLD);
    expect(result.scores[6]).toBeLessThan(ANOMALY_THRESHOLD);
  });

  it('declines when the data cannot support it', () => {
    // Too few rows.
    expect(isolationScores(['a', 'b'], [['1'], ['2']])).toBeNull();
    // Only one numeric column.
    const { header, columns } = planted();
    const words: Cell[] = columns[0].map((_, i) => `w${i % 3}`);
    expect(isolationScores([header[0], 'text'], [columns[0], words])).toBeNull();
  });
});

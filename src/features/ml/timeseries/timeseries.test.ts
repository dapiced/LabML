import { describe, expect, it } from 'vitest';
import { backtest, holdoutLength, residualBand } from './backtest';
import { candidateForecasters } from './forecast';
import { runForecast } from './run';
import { buildSeries, extendTimeAxis, parseDate } from './series';
import type { Cell } from '@/features/ml/data/types';

const DAY = 24 * 3600 * 1000;

describe('parseDate / buildSeries', () => {
  it('parses ISO and slash dates (day-first)', () => {
    expect(parseDate('2026-05-03')).toBe(Date.UTC(2026, 4, 3));
    expect(parseDate('2026-05')).toBe(Date.UTC(2026, 4, 1));
    expect(parseDate('03/05/2026')).toBe(Date.UTC(2026, 4, 3));
    expect(parseDate('not a date')).toBeNull();
  });

  it('sorts, aggregates duplicates by mean, counts drops', () => {
    const dates: Cell[] = ['2026-01-02', '2026-01-01', '2026-01-02', 'oops', '2026-01-03'];
    const values: Cell[] = ['10', '1', '20', '5', null];
    const series = buildSeries(dates, values);
    expect(series.t).toEqual([Date.UTC(2026, 0, 1), Date.UTC(2026, 0, 2)]);
    expect(series.y).toEqual([1, 15]);
    expect(series.dropped).toBe(2);
  });

  it('infers a daily frequency with weekly seasonality when long enough', () => {
    const dates: Cell[] = Array.from({ length: 30 }, (_, i) =>
      new Date(Date.UTC(2026, 0, 1) + i * DAY).toISOString().slice(0, 10),
    );
    const values: Cell[] = dates.map((_, i) => String(i));
    const series = buildSeries(dates, values);
    expect(series.freq).toBe('daily');
    expect(series.seasonalPeriod).toBe(7);
  });

  it('extends the time axis by the median gap', () => {
    const t = [0, DAY, 2 * DAY];
    expect(extendTimeAxis(t, 2)).toEqual([3 * DAY, 4 * DAY]);
  });
});

describe('forecasters', () => {
  it('all forecast a constant series as constant', () => {
    const y = Array.from({ length: 40 }, () => 5);
    for (const forecaster of candidateForecasters(y.length, 7)) {
      for (const value of forecaster.forecast(y, 3)) {
        expect(value).toBeCloseTo(5, 6);
      }
    }
  });

  it('Holt extrapolates a perfect linear trend', () => {
    const y = Array.from({ length: 40 }, (_, i) => 3 + 2 * i);
    const holt = candidateForecasters(y.length).find((c) => c.key === 'holt')!;
    const [next1, , next3] = holt.forecast(y, 3);
    expect(next1).toBeCloseTo(3 + 2 * 40, 1);
    expect(next3).toBeCloseTo(3 + 2 * 42, 1);
  });

  it('Holt-Winters beats naive on a strongly seasonal series', () => {
    const pattern = [0, 8, 3, -4, -7, 1, 6];
    const y = Array.from({ length: 70 }, (_, i) => 50 + 0.1 * i + pattern[i % 7]);
    const holdout = holdoutLength(y.length);
    const candidates = candidateForecasters(y.length, 7);
    const naive = backtest(
      y,
      candidates.find((c) => c.key === 'naive')!,
      holdout,
    )!;
    const hwScores = candidates
      .filter((c) => c.key === 'holtWinters')
      .map((c) => backtest(y, c, holdout)!)
      .sort((a, b) => a.mae - b.mae);
    expect(hwScores[0].mae).toBeLessThan(naive.mae / 2);
  });
});

describe('backtest / residualBand', () => {
  it('scores a known one-step naive backtest by hand', () => {
    // y: 1..10 → naive one-step error is always 1 on the holdout.
    const y = Array.from({ length: 10 }, (_, i) => i + 1);
    const naive = candidateForecasters(y.length).find((c) => c.key === 'naive')!;
    const score = backtest(y, naive, 8)!;
    expect(score.mae).toBeCloseTo(1, 10);
    expect(score.rmse).toBeCloseTo(1, 10);
  });

  it('builds an empirical 80% band from residuals', () => {
    const residuals = Array.from({ length: 100 }, (_, i) => i - 50);
    const band = residualBand(residuals);
    expect(band.lo).toBe(-40);
    expect(band.hi).toBe(40);
  });
});

describe('runForecast', () => {
  const dates: Cell[] = Array.from({ length: 84 }, (_, i) =>
    new Date(Date.UTC(2026, 0, 1) + i * DAY).toISOString().slice(0, 10),
  );
  const pattern = [0, 8, 3, -4, -7, 1, 6];
  const values: Cell[] = dates.map((_, i) => String(50 + 0.1 * i + pattern[i % 7]));

  it('selects a seasonal winner, beats naive, and forecasts with a band', () => {
    const payload = runForecast(dates, values, 'date', 'kwh');
    expect(payload.freq).toBe('daily');
    expect(payload.seasonalPeriod).toBe(7);
    expect(['holtWinters', 'seasonalNaive']).toContain(payload.winner.key);
    expect(payload.winner.mae).toBeLessThan(payload.naiveMae);
    expect(payload.forecast).toHaveLength(14);
    for (const point of payload.forecast) {
      expect(point.lo).toBeLessThanOrEqual(point.yhat);
      expect(point.hi).toBeGreaterThanOrEqual(point.yhat);
    }
    // The forecast continues the weekly pattern: the max of a future week
    // falls on the same weekday as the max of the last observed week.
    const week = payload.forecast.slice(0, 7).map((p) => p.yhat);
    expect(week.indexOf(Math.max(...week))).toBe(1); // pattern peaks at offset 1
  });

  it('is deterministic', () => {
    expect(runForecast(dates, values, 'date', 'kwh')).toEqual(
      runForecast(dates, values, 'date', 'kwh'),
    );
  });

  it('refuses a series that is too short', () => {
    expect(() => runForecast(dates.slice(0, 8), values.slice(0, 8), 'd', 'v')).toThrow(
      'too-few-points',
    );
  });
});

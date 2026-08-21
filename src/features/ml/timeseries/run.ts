import {
  backtest,
  holdoutLength,
  residualBand,
  type BacktestScore,
} from '@/features/ml/timeseries/backtest';
import { candidateForecasters, type MethodKey } from '@/features/ml/timeseries/forecast';
import { buildSeries, extendTimeAxis, type Frequency } from '@/features/ml/timeseries/series';
import type { Cell } from '@/features/ml/data/types';

const CHART_POINTS = 120;
const METHODS_SHOWN = 6;

export interface MethodScore {
  key: MethodKey;
  params: Record<string, number>;
  mae: number;
  rmse: number;
}

export interface ForecastPoint {
  t: number;
  yhat: number;
  lo: number;
  hi: number;
}

export interface ForecastPayload {
  dateColumn: string;
  valueColumn: string;
  freq: Frequency;
  seasonalPeriod?: number;
  /** Chart tail of the observed series. */
  points: { t: number; y: number }[];
  totalPoints: number;
  dropped: number;
  holdout: number;
  /** Best backtest per method family, best first. */
  methods: MethodScore[];
  winner: MethodScore;
  naiveMae: number;
  forecast: ForecastPoint[];
}

export function runForecast(
  dates: Cell[],
  values: Cell[],
  dateColumn: string,
  valueColumn: string,
): ForecastPayload {
  const series = buildSeries(dates, values);
  const n = series.t.length;
  if (n < 12) throw new Error('too-few-points');

  const holdout = holdoutLength(n);
  const candidates = candidateForecasters(n, series.seasonalPeriod);
  const scores: BacktestScore[] = [];
  for (const candidate of candidates) {
    const score = backtest(series.y, candidate, holdout);
    if (score) scores.push(score);
  }
  if (scores.length === 0) throw new Error('too-few-points');
  scores.sort((a, b) => a.mae - b.mae);
  const winner = scores[0];
  const naiveMae = scores.find((score) => score.key === 'naive')?.mae ?? Number.NaN;

  // Best configuration per method family, for the comparison table.
  const seen = new Set<MethodKey>();
  const methods: MethodScore[] = [];
  for (const score of scores) {
    if (seen.has(score.key)) continue;
    seen.add(score.key);
    methods.push({ key: score.key, params: score.params, mae: score.mae, rmse: score.rmse });
    if (methods.length >= METHODS_SHOWN) break;
  }

  // Refit the winner on the full series and forecast ahead.
  const m = series.seasonalPeriod;
  const h = Math.min(m !== undefined ? 2 * m : 12, 28, Math.floor(n / 2));
  const forecaster = candidates.find(
    (candidate) =>
      candidate.key === winner.key &&
      JSON.stringify(candidate.params) === JSON.stringify(winner.params),
  )!;
  const yhat = forecaster.forecast(series.y, h);
  const band = residualBand(winner.residuals);
  const futureT = extendTimeAxis(series.t, h);
  const forecast: ForecastPoint[] = yhat.map((value, i) => ({
    t: futureT[i],
    yhat: Math.round(value * 1000) / 1000,
    lo: Math.round((value + band.lo) * 1000) / 1000,
    hi: Math.round((value + band.hi) * 1000) / 1000,
  }));

  const tail = Math.max(0, n - CHART_POINTS);
  return {
    dateColumn,
    valueColumn,
    freq: series.freq,
    seasonalPeriod: series.seasonalPeriod,
    points: series.t.slice(tail).map((t, i) => ({ t, y: series.y[tail + i] })),
    totalPoints: n,
    dropped: series.dropped,
    holdout,
    methods,
    winner: { key: winner.key, params: winner.params, mae: winner.mae, rmse: winner.rmse },
    naiveMae,
    forecast,
  };
}

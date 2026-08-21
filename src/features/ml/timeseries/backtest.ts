/**
 * Rolling-origin (expanding window) one-step backtest: every point of the
 * holdout is forecast using only the observations that precede it — the
 * future is never seen. Winner by MAE; empirical 80% intervals come from
 * the winner's backtest residuals.
 */
import type { Forecaster, MethodKey } from '@/features/ml/timeseries/forecast';

/** Backtest length: last 20% of the series, clamped to [8, 60] points. */
export function holdoutLength(n: number): number {
  return Math.max(8, Math.min(60, Math.floor(n * 0.2)));
}

export interface BacktestScore {
  key: MethodKey;
  params: Record<string, number>;
  mae: number;
  rmse: number;
  residuals: number[];
}

export function backtest(
  y: number[],
  forecaster: Forecaster,
  holdout: number,
): BacktestScore | null {
  const start = y.length - holdout;
  if (start < forecaster.minLength) return null;
  const residuals: number[] = [];
  let absSum = 0;
  let squaredSum = 0;
  for (let i = start; i < y.length; i++) {
    const [prediction] = forecaster.forecast(y.slice(0, i), 1);
    const error = y[i] - prediction;
    residuals.push(error);
    absSum += Math.abs(error);
    squaredSum += error * error;
  }
  return {
    key: forecaster.key,
    params: forecaster.params,
    mae: absSum / holdout,
    rmse: Math.sqrt(squaredSum / holdout),
    residuals,
  };
}

/** Empirical [10th, 90th] percentile band of the residuals. */
export function residualBand(residuals: number[]): { lo: number; hi: number } {
  const sorted = [...residuals].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { lo: at(0.1), hi: at(0.9) };
}

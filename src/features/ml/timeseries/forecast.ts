/**
 * Hand-written exponential-smoothing family: naive, seasonal naive, SES,
 * Holt (linear trend) and additive Holt-Winters. Each forecaster fits on a
 * prefix and predicts one step or h steps ahead — deterministic throughout.
 */

export type MethodKey = 'naive' | 'seasonalNaive' | 'ses' | 'holt' | 'holtWinters';

export interface Forecaster {
  key: MethodKey;
  params: Record<string, number>;
  /** Fits on `y` and returns the forecasts 1…h steps beyond its end. */
  forecast(y: number[], h: number): number[];
  /** Minimum observations needed to fit. */
  minLength: number;
}

function naive(): Forecaster {
  return {
    key: 'naive',
    params: {},
    minLength: 1,
    forecast: (y, h) => Array.from({ length: h }, () => y[y.length - 1]),
  };
}

function seasonalNaive(m: number): Forecaster {
  return {
    key: 'seasonalNaive',
    params: { m },
    minLength: m + 1,
    forecast: (y, h) =>
      Array.from({ length: h }, (_, i) => y[y.length - m + (((i % m) + m) % m)] ?? y[y.length - 1]),
  };
}

function ses(alpha: number): Forecaster {
  return {
    key: 'ses',
    params: { alpha },
    minLength: 2,
    forecast: (y, h) => {
      let level = y[0];
      for (let i = 1; i < y.length; i++) level = alpha * y[i] + (1 - alpha) * level;
      return Array.from({ length: h }, () => level);
    },
  };
}

function holt(alpha: number, beta: number): Forecaster {
  return {
    key: 'holt',
    params: { alpha, beta },
    minLength: 3,
    forecast: (y, h) => {
      let level = y[0];
      let trend = y[1] - y[0];
      for (let i = 1; i < y.length; i++) {
        const previousLevel = level;
        level = alpha * y[i] + (1 - alpha) * (level + trend);
        trend = beta * (level - previousLevel) + (1 - beta) * trend;
      }
      return Array.from({ length: h }, (_, i) => level + (i + 1) * trend);
    },
  };
}

function holtWinters(alpha: number, beta: number, gamma: number, m: number): Forecaster {
  return {
    key: 'holtWinters',
    params: { alpha, beta, gamma, m },
    minLength: 2 * m + 1,
    forecast: (y, h) => {
      // Classical initialization on the first two seasons.
      const season1 = y.slice(0, m);
      const season2 = y.slice(m, 2 * m);
      const mean1 = season1.reduce((a, v) => a + v, 0) / m;
      const mean2 = season2.reduce((a, v) => a + v, 0) / m;
      let level = mean1;
      let trend = (mean2 - mean1) / m;
      const seasonal = season1.map((v) => v - mean1);

      for (let i = 0; i < y.length; i++) {
        const s = i % m;
        const previousLevel = level;
        level = alpha * (y[i] - seasonal[s]) + (1 - alpha) * (level + trend);
        trend = beta * (level - previousLevel) + (1 - beta) * trend;
        seasonal[s] = gamma * (y[i] - level) + (1 - gamma) * seasonal[s];
      }
      return Array.from({ length: h }, (_, i) => {
        const s = (y.length + i) % m;
        return level + (i + 1) * trend + seasonal[s];
      });
    },
  };
}

/** The candidate grid, filtered by series length and seasonal availability. */
export function candidateForecasters(length: number, seasonalPeriod?: number): Forecaster[] {
  const candidates: Forecaster[] = [naive()];
  for (const alpha of [0.2, 0.5, 0.8]) candidates.push(ses(alpha));
  for (const alpha of [0.2, 0.5, 0.8]) {
    for (const beta of [0.05, 0.2]) candidates.push(holt(alpha, beta));
  }
  if (seasonalPeriod !== undefined) {
    candidates.push(seasonalNaive(seasonalPeriod));
    for (const alpha of [0.2, 0.5]) {
      for (const beta of [0.05, 0.2]) {
        for (const gamma of [0.05, 0.2]) {
          candidates.push(holtWinters(alpha, beta, gamma, seasonalPeriod));
        }
      }
    }
  }
  return candidates.filter((candidate) => candidate.minLength <= Math.floor(length * 0.8));
}

/**
 * From two raw columns (a date, a numeric value) to a clean time series:
 * parse, sort, aggregate duplicate timestamps by mean, infer the sampling
 * frequency from the median gap and suggest a seasonal period.
 */
import { isMissing, parseNumber } from '@/features/ml/data/infer';
import type { Cell } from '@/features/ml/data/types';

export type Frequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'irregular';

export interface TimeSeries {
  /** Timestamps (ms since epoch), strictly increasing. */
  t: number[];
  y: number[];
  freq: Frequency;
  /** Suggested seasonal period in observations (undefined = none). */
  seasonalPeriod?: number;
  /** Rows that could not be parsed (bad date or value). */
  dropped: number;
}

const ISO = /^\d{4}-\d{2}(-\d{2})?([ T]\d{2}:\d{2}(:\d{2})?)?$/;
const SLASH = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/;

/** Parses a date cell to a UTC timestamp, or null. */
export function parseDate(raw: string): number | null {
  const cleaned = raw.trim();
  if (ISO.test(cleaned)) {
    const iso = cleaned.length === 7 ? `${cleaned}-01` : cleaned.replace(' ', 'T');
    const value = Date.parse(iso.includes('T') ? `${iso}Z` : `${iso}T00:00:00Z`);
    return Number.isNaN(value) ? null : value;
  }
  const slash = SLASH.exec(cleaned);
  if (slash) {
    // Day-first (French habit); falls back to month-first when day > 12.
    const [, a, b, year] = slash;
    let day = Number(a);
    let month = Number(b);
    if (month > 12 && day <= 12) [day, month] = [month, day];
    if (month > 12 || day > 31) return null;
    const fullYear = year.length === 2 ? Number(year) + 2000 : Number(year);
    const value = Date.UTC(fullYear, month - 1, day);
    return Number.isNaN(value) ? null : value;
  }
  return null;
}

const DAY = 24 * 3600 * 1000;

function inferFrequency(gaps: number[]): { freq: Frequency; seasonalPeriod?: number } {
  if (gaps.length === 0) return { freq: 'irregular' };
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] / DAY;
  if (median <= 1.5) return { freq: 'daily', seasonalPeriod: 7 };
  if (median <= 10) return { freq: 'weekly' };
  if (median <= 45) return { freq: 'monthly', seasonalPeriod: 12 };
  if (median <= 135) return { freq: 'quarterly', seasonalPeriod: 4 };
  if (median <= 550) return { freq: 'yearly' };
  return { freq: 'irregular' };
}

export function buildSeries(dates: Cell[], values: Cell[]): TimeSeries {
  const byTime = new Map<number, { sum: number; count: number }>();
  let dropped = 0;
  const total = Math.min(dates.length, values.length);
  for (let i = 0; i < total; i++) {
    const dateCell = dates[i];
    const valueCell = values[i];
    if (isMissing(dateCell) || isMissing(valueCell)) {
      dropped += 1;
      continue;
    }
    const timestamp = parseDate(dateCell as string);
    const value = parseNumber((valueCell as string).trim());
    if (timestamp === null || value === null) {
      dropped += 1;
      continue;
    }
    const bucket = byTime.get(timestamp);
    if (bucket) {
      bucket.sum += value;
      bucket.count += 1;
    } else {
      byTime.set(timestamp, { sum: value, count: 1 });
    }
  }

  const t = [...byTime.keys()].sort((a, b) => a - b);
  const y = t.map((timestamp) => {
    const bucket = byTime.get(timestamp)!;
    return bucket.sum / bucket.count;
  });
  const gaps = t.slice(1).map((timestamp, i) => timestamp - t[i]);
  const { freq, seasonalPeriod } = inferFrequency(gaps);

  // A seasonal period only makes sense with at least two full cycles.
  const usablePeriod =
    seasonalPeriod !== undefined && t.length >= 2 * seasonalPeriod + 4 ? seasonalPeriod : undefined;

  return { t, y, freq, seasonalPeriod: usablePeriod, dropped };
}

/** Extends the time axis h steps beyond the end, using the median gap. */
export function extendTimeAxis(t: number[], h: number): number[] {
  if (t.length < 2) return Array.from({ length: h }, (_, i) => (t[0] ?? 0) + (i + 1) * DAY);
  const gaps = t.slice(1).map((timestamp, i) => timestamp - t[i]);
  const sorted = [...gaps].sort((a, b) => a - b);
  const step = sorted[Math.floor(sorted.length / 2)];
  const last = t[t.length - 1];
  return Array.from({ length: h }, (_, i) => last + (i + 1) * step);
}

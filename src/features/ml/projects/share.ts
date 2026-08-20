import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import type { RunRecord, SharePayload } from '@/features/ml/projects/types';

/**
 * Share links carry the run's metrics and insights — never the data — inside
 * the URL *fragment*: browsers do not send anything after `#` to any server,
 * so sharing keeps the privacy promise intact.
 */
export function encodeShareFragment(record: RunRecord): string {
  const payload: SharePayload = {
    v: 1,
    name: record.name,
    createdAt: record.createdAt,
    dataset: record.dataset,
    target: record.target,
    taskType: record.taskType,
    seed: record.seed,
    results: record.results,
    summary: record.summary,
    insights: trimInsights(record.insights),
  };
  return compressToEncodedURIComponent(JSON.stringify(payload));
}

export function decodeShareFragment(fragment: string): SharePayload | null {
  try {
    const json = decompressFromEncodedURIComponent(fragment);
    if (!json) return null;
    const payload = JSON.parse(json) as SharePayload;
    if (payload.v !== 1 || !Array.isArray(payload.results) || !payload.summary) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Caps the heavier insight arrays so links stay comfortably short. */
function trimInsights(insights: RunRecord['insights']): RunRecord['insights'] {
  return {
    ...insights,
    roc: insights.roc
      ? { ...insights.roc, points: downsample(insights.roc.points, 50) }
      : undefined,
    scatter: insights.scatter ? downsample(insights.scatter, 100) : undefined,
  };
}

function downsample<T>(points: T[], cap: number): T[] {
  if (points.length <= cap) return points;
  const step = Math.ceil(points.length / cap);
  const sampled = points.filter((_, i) => i % step === 0);
  const last = points[points.length - 1];
  if (sampled[sampled.length - 1] !== last) sampled.push(last);
  return sampled;
}

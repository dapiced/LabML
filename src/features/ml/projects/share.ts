import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import type { RunRecord, SharePayload } from '@/features/ml/projects/types';

/**
 * Share links carry the run's metrics and insights — never the data — inside
 * the URL *fragment*: browsers do not send anything after `#` to any server,
 * so sharing keeps the privacy promise intact.
 */
export function encodeShareFragment(record: RunRecord): string {
  const payload: SharePayload = {
    v: 2,
    name: record.name,
    createdAt: record.createdAt,
    dataset: record.dataset,
    target: record.target,
    taskType: record.taskType,
    seed: record.seed,
    results: record.results,
    summary: record.summary,
    insights: trimInsights(record.insights),
    artifacts: trimArtifacts(record.artifacts),
  };
  return compressToEncodedURIComponent(JSON.stringify(payload));
}

export function decodeShareFragment(fragment: string): SharePayload | null {
  try {
    const json = decompressFromEncodedURIComponent(fragment);
    if (!json) return null;
    const payload = JSON.parse(json) as SharePayload;
    // v1 links predate run artifacts and must keep working.
    if (payload.v !== 1 && payload.v !== 2) return null;
    if (!Array.isArray(payload.results) || !payload.summary) return null;
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

/** The point clouds are the only heavy artifact parts — cap them for the URL. */
function trimArtifacts(artifacts: RunRecord['artifacts']): RunRecord['artifacts'] {
  if (!artifacts) return undefined;
  const trimmed: RunRecord['artifacts'] = { ...artifacts };
  if (artifacts.exploration) {
    trimmed.exploration = {
      ...artifacts.exploration,
      points: downsample(artifacts.exploration.points, 120),
    };
  }
  if (artifacts.forecast) {
    trimmed.forecast = { ...artifacts.forecast, points: artifacts.forecast.points.slice(-60) };
  }
  return trimmed;
}

function downsample<T>(points: T[], cap: number): T[] {
  if (points.length <= cap) return points;
  const step = Math.ceil(points.length / cap);
  const sampled = points.filter((_, i) => i % step === 0);
  const last = points[points.length - 1];
  if (sampled[sampled.length - 1] !== last) sampled.push(last);
  return sampled;
}

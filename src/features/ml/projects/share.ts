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

/**
 * V35 wave 4 — a share link is untrusted input, and until now it was checked
 * for three fields out of ten.
 *
 * `v`, `results` being an array, and a truthy `summary` were enough to be
 * handed straight to `RunView`, which then reads `record.dataset.name` and
 * `result.model`. Measured on six crafted fragments — every one of them passed
 * the old check and every one of them crashed the render with « Cannot read
 * properties of undefined », i.e. a white page where the « invalid link »
 * message was supposed to be.
 *
 * This is not a security hole: nothing in the fragment executes, React escapes
 * every string it renders, and `JSON.parse` puts `__proto__` on the object as
 * an ordinary key rather than on the prototype (verified: `({}).pwned` stays
 * undefined). What it is, is a link that cannot say « I am broken » — and the
 * common case is not an attacker at all, it is a legitimate share URL that a
 * chat client truncated.
 *
 * So the shape is checked against what the view actually reads. Anything short
 * of that returns `null`, and the page shows the refusal it already has.
 */
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The fields `RunView` dereferences without guarding — all of them. */
function isRenderable(payload: Record<string, unknown>): boolean {
  if (typeof payload.name !== 'string' || typeof payload.target !== 'string') return false;
  if (typeof payload.createdAt !== 'number' || typeof payload.seed !== 'number') return false;
  if (typeof payload.taskType !== 'string') return false;
  const dataset = payload.dataset;
  if (!isObject(dataset)) return false;
  // `dataset.rowCount.toLocaleString(lang)` runs on the very first render.
  if (typeof dataset.name !== 'string') return false;
  if (typeof dataset.rowCount !== 'number' || typeof dataset.columnCount !== 'number') return false;
  if (!isObject(payload.summary) || !isObject(payload.insights)) return false;
  if (!Array.isArray(payload.results)) return false;
  // The leaderboard reads every row as `{ key, metrics }`; one bad entry
  // breaks that row, so the link is refused rather than half-rendered.
  return payload.results.every(
    (result) => isObject(result) && typeof result.key === 'string' && isObject(result.metrics),
  );
}

export function decodeShareFragment(fragment: string): SharePayload | null {
  try {
    const json = decompressFromEncodedURIComponent(fragment);
    if (!json) return null;
    const payload: unknown = JSON.parse(json);
    if (!isObject(payload)) return null;
    // v1 links predate run artifacts and must keep working.
    if (payload.v !== 1 && payload.v !== 2) return null;
    if (!isRenderable(payload)) return null;
    return payload as unknown as SharePayload;
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

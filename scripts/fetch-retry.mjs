/**
 * V41.1 — Hugging Face answers anonymous CI runners with 429 when too many
 * requests share an IP. The deploy used to die on the first one; it now waits
 * (honouring Retry-After when given) and tries again. 404 and other 4xx are
 * returned untouched: retrying them would only hide a real mistake.
 */
const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function isRetryable(status) {
  return status === 408 || status === 429 || status >= 500;
}

export function retryDelayMs(response, attempt, maxDelayMs) {
  const header = response?.headers?.get?.('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.min(seconds * 1000, maxDelayMs);
    const at = Date.parse(header);
    if (Number.isFinite(at)) return Math.min(Math.max(at - Date.now(), 0), maxDelayMs);
  }
  const base = 2000 * 2 ** attempt;
  return Math.min(base + Math.floor(Math.random() * 1000), maxDelayMs);
}

export async function fetchWithRetry(url, init = {}, options = {}) {
  const {
    fetchFn = fetch,
    sleep = sleepMs,
    attempts = 6,
    maxDelayMs = 60_000,
    onRetry = () => {},
  } = options;
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const last = attempt === attempts - 1;
    let response;
    try {
      response = await fetchFn(url, init);
    } catch (error) {
      lastError = error;
      if (last) throw error;
      const delay = retryDelayMs(undefined, attempt, maxDelayMs);
      onRetry({ attempt: attempt + 1, delay, reason: String(error?.message ?? error) });
      await sleep(delay);
      continue;
    }
    if (response.ok || !isRetryable(response.status) || last) return response;
    const delay = retryDelayMs(response, attempt, maxDelayMs);
    onRetry({ attempt: attempt + 1, delay, reason: `HTTP ${response.status}` });
    await response.body?.cancel?.().catch(() => {});
    await sleep(delay);
  }
  throw lastError;
}

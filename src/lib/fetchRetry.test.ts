import { describe, expect, it, vi } from 'vitest';
import { fetchWithRetry, retryDelayMs } from '../../scripts/fetch-retry.mjs';

const ok = () => new Response('ok', { status: 200 });
const status = (code: number, headers: Record<string, string> = {}) =>
  new Response('', { status: code, headers });

describe('fetchWithRetry', () => {
  it('retries a 429 and returns the eventual success', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(status(429)).mockResolvedValueOnce(ok());
    const sleep = vi.fn().mockResolvedValue(undefined);
    const response = await fetchWithRetry('u', {}, { fetchFn, sleep, attempts: 3 });
    expect(response.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('retries 5xx and network errors', async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(status(503))
      .mockResolvedValueOnce(ok());
    const sleep = vi.fn().mockResolvedValue(undefined);
    const response = await fetchWithRetry('u', {}, { fetchFn, sleep, attempts: 5 });
    expect(response.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('does not retry a 404', async () => {
    const fetchFn = vi.fn().mockResolvedValue(status(404));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const response = await fetchWithRetry('u', {}, { fetchFn, sleep, attempts: 5 });
    expect(response.status).toBe(404);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('returns the last 429 once attempts are exhausted', async () => {
    const fetchFn = vi.fn().mockResolvedValue(status(429));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const response = await fetchWithRetry('u', {}, { fetchFn, sleep, attempts: 3 });
    expect(response.status).toBe(429);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});

describe('retryDelayMs', () => {
  it('honours Retry-After in seconds, capped', () => {
    expect(retryDelayMs(status(429, { 'Retry-After': '7' }), 0, 60_000)).toBe(7000);
    expect(retryDelayMs(status(429, { 'Retry-After': '999' }), 0, 60_000)).toBe(60_000);
  });

  it('backs off exponentially without a header', () => {
    const first = retryDelayMs(status(429), 0, 60_000);
    const third = retryDelayMs(status(429), 2, 60_000);
    expect(third).toBeGreaterThan(first);
  });
});

export interface RetryOptions {
  fetchFn?: (url: string, init?: RequestInit) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
  attempts?: number;
  maxDelayMs?: number;
  onRetry?: (info: { attempt: number; delay: number; reason: string }) => void;
}

export function isRetryable(status: number): boolean;
export function retryDelayMs(
  response: Response | undefined,
  attempt: number,
  maxDelayMs: number,
): number;
export function fetchWithRetry(
  url: string,
  init?: RequestInit,
  options?: RetryOptions,
): Promise<Response>;

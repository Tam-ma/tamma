import { RateLimitError } from '../types/errors.js';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

export async function withRateLimit<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;

      if (!isRetryableError(err)) {
        throw err;
      }

      const delayMs = getRetryDelay(err, attempt);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

function isRetryableError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) {
    return false;
  }

  const status = 'status' in err ? (err as { status: number }).status : 0;

  if (status === 429) {
    return true;
  }

  if (status === 403) {
    const message =
      'message' in err ? String((err as { message: string }).message) : '';
    return message.toLowerCase().includes('rate limit');
  }

  // Retry on transient server errors (common for GitHub API)
  if (status === 502 || status === 503 || status === 504) {
    return true;
  }

  return false;
}

function getRetryDelay(err: unknown, attempt: number): number {
  if (err instanceof RateLimitError) {
    return err.retryAfterMs;
  }

  if (typeof err === 'object' && err !== null) {
    const headers =
      'response' in err &&
      typeof (err as Record<string, unknown>)['response'] === 'object' &&
      (err as Record<string, unknown>)['response'] !== null
        ? ((err as { response: { headers?: Record<string, string> } }).response
            .headers ?? {})
        : {};

    const retryAfter = headers['retry-after'];
    if (retryAfter !== undefined) {
      const seconds = parseInt(retryAfter, 10);
      if (!isNaN(seconds)) {
        return seconds * 1000;
      }
    }

    const resetTime = headers['x-ratelimit-reset'];
    if (resetTime !== undefined) {
      const resetEpoch = parseInt(resetTime, 10);
      if (!isNaN(resetEpoch)) {
        const delayMs = resetEpoch * 1000 - Date.now();
        if (delayMs > 0) {
          return delayMs;
        }
      }
    }
  }

  // Exponential backoff with jitter
  const jitter = Math.random() * 500;
  return BASE_DELAY_MS * Math.pow(2, attempt) + jitter;
}

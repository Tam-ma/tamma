import {
  GitPlatformError,
  RateLimitError,
  NotFoundError,
  AuthenticationError,
  ValidationError,
} from '../types/errors.js';

export function mapGitHubError(err: unknown): Error {
  if (
    err instanceof GitPlatformError ||
    err instanceof RateLimitError ||
    err instanceof NotFoundError ||
    err instanceof AuthenticationError ||
    err instanceof ValidationError
  ) {
    return err;
  }

  if (typeof err !== 'object' || err === null) {
    return new GitPlatformError(String(err), 0);
  }

  const status = 'status' in err ? (err as { status: number }).status : 0;
  const message =
    'message' in err ? String((err as { message: string }).message) : 'Unknown error';
  const causeOpts = err instanceof Error ? { cause: err } : {};

  switch (status) {
    case 401:
      return new AuthenticationError(message, causeOpts);
    case 403: {
      const isRateLimit = message.toLowerCase().includes('rate limit');
      if (isRateLimit) {
        return new RateLimitError(message, 60000, causeOpts);
      }
      return new GitPlatformError(message, 403, causeOpts);
    }
    case 404:
      return new NotFoundError(message, causeOpts);
    case 422:
      return new ValidationError(message, causeOpts);
    case 429: {
      const retryAfterMs = extractRetryAfter(err);
      return new RateLimitError(message, retryAfterMs, causeOpts);
    }
    default:
      return new GitPlatformError(message, status, {
        retryable: status >= 500,
        ...causeOpts,
      });
  }
}

function extractRetryAfter(err: unknown): number {
  if (typeof err === 'object' && err !== null && 'response' in err) {
    const response = (err as { response: { headers?: Record<string, string> } })
      .response;
    const retryAfter = response?.headers?.['retry-after'];
    if (retryAfter !== undefined) {
      const seconds = parseInt(retryAfter, 10);
      if (!isNaN(seconds)) {
        return seconds * 1000;
      }
    }
  }
  return 60000;
}

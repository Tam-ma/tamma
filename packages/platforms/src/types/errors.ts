export class GitPlatformError extends Error {
  public readonly statusCode: number;
  public readonly retryable: boolean;

  constructor(
    message: string,
    statusCode: number,
    options?: { retryable?: boolean; cause?: Error },
  ) {
    super(message, { cause: options?.cause });
    this.name = 'GitPlatformError';
    this.statusCode = statusCode;
    this.retryable = options?.retryable ?? false;
  }
}

export class RateLimitError extends GitPlatformError {
  public readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs: number, options?: { cause?: Error }) {
    super(message, 429, { retryable: true, ...options });
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

export class NotFoundError extends GitPlatformError {
  constructor(message: string, options?: { cause?: Error }) {
    super(message, 404, { retryable: false, ...options });
    this.name = 'NotFoundError';
  }
}

export class AuthenticationError extends GitPlatformError {
  constructor(message: string, options?: { cause?: Error }) {
    super(message, 401, { retryable: false, ...options });
    this.name = 'AuthenticationError';
  }
}

export class ValidationError extends GitPlatformError {
  constructor(message: string, options?: { cause?: Error }) {
    super(message, 422, { retryable: false, ...options });
    this.name = 'ValidationError';
  }
}

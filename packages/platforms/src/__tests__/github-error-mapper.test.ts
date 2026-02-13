import { describe, it, expect } from 'vitest';
import { mapGitHubError } from '../github/github-error-mapper.js';
import {
  GitPlatformError,
  RateLimitError,
  NotFoundError,
  AuthenticationError,
  ValidationError,
} from '../types/errors.js';

describe('mapGitHubError', () => {
  describe('pass-through of existing platform errors', () => {
    it('should return GitPlatformError as-is', () => {
      const err = new GitPlatformError('platform fail', 500);
      const result = mapGitHubError(err);
      expect(result).toBe(err);
    });

    it('should return RateLimitError as-is', () => {
      const err = new RateLimitError('rate limited', 30000);
      const result = mapGitHubError(err);
      expect(result).toBe(err);
    });

    it('should return NotFoundError as-is', () => {
      const err = new NotFoundError('not found');
      const result = mapGitHubError(err);
      expect(result).toBe(err);
    });

    it('should return AuthenticationError as-is', () => {
      const err = new AuthenticationError('bad token');
      const result = mapGitHubError(err);
      expect(result).toBe(err);
    });

    it('should return ValidationError as-is', () => {
      const err = new ValidationError('invalid input');
      const result = mapGitHubError(err);
      expect(result).toBe(err);
    });
  });

  describe('non-object errors', () => {
    it('should wrap a string in GitPlatformError with status 0', () => {
      const result = mapGitHubError('something broke');
      expect(result).toBeInstanceOf(GitPlatformError);
      expect(result.message).toBe('something broke');
      expect((result as GitPlatformError).statusCode).toBe(0);
    });

    it('should wrap a number in GitPlatformError with status 0', () => {
      const result = mapGitHubError(42);
      expect(result).toBeInstanceOf(GitPlatformError);
      expect(result.message).toBe('42');
      expect((result as GitPlatformError).statusCode).toBe(0);
    });

    it('should wrap null in GitPlatformError with status 0', () => {
      const result = mapGitHubError(null);
      expect(result).toBeInstanceOf(GitPlatformError);
      expect(result.message).toBe('null');
      expect((result as GitPlatformError).statusCode).toBe(0);
    });

    it('should wrap undefined in GitPlatformError with status 0', () => {
      const result = mapGitHubError(undefined);
      expect(result).toBeInstanceOf(GitPlatformError);
      expect(result.message).toBe('undefined');
      expect((result as GitPlatformError).statusCode).toBe(0);
    });
  });

  describe('status code mapping', () => {
    it('should map 401 to AuthenticationError', () => {
      const result = mapGitHubError({ status: 401, message: 'Bad credentials' });
      expect(result).toBeInstanceOf(AuthenticationError);
      expect(result.message).toBe('Bad credentials');
      expect((result as AuthenticationError).statusCode).toBe(401);
    });

    it('should map 403 to GitPlatformError when not rate-limited', () => {
      const result = mapGitHubError({ status: 403, message: 'Forbidden' });
      expect(result).toBeInstanceOf(GitPlatformError);
      expect(result).not.toBeInstanceOf(RateLimitError);
      expect(result.message).toBe('Forbidden');
      expect((result as GitPlatformError).statusCode).toBe(403);
    });

    it('should map 403 with "rate limit" message to RateLimitError', () => {
      const result = mapGitHubError({
        status: 403,
        message: 'API rate limit exceeded',
      });
      expect(result).toBeInstanceOf(RateLimitError);
      expect(result.message).toBe('API rate limit exceeded');
      expect((result as RateLimitError).retryAfterMs).toBe(60000);
    });

    it('should map 403 with "Rate Limit" (mixed case) to RateLimitError', () => {
      const result = mapGitHubError({
        status: 403,
        message: 'Rate Limit exceeded for resource',
      });
      expect(result).toBeInstanceOf(RateLimitError);
    });

    it('should map 404 to NotFoundError', () => {
      const result = mapGitHubError({ status: 404, message: 'Not Found' });
      expect(result).toBeInstanceOf(NotFoundError);
      expect(result.message).toBe('Not Found');
      expect((result as NotFoundError).statusCode).toBe(404);
    });

    it('should map 422 to ValidationError', () => {
      const result = mapGitHubError({
        status: 422,
        message: 'Validation Failed',
      });
      expect(result).toBeInstanceOf(ValidationError);
      expect(result.message).toBe('Validation Failed');
      expect((result as ValidationError).statusCode).toBe(422);
    });

    it('should map 429 to RateLimitError with default retryAfterMs', () => {
      const result = mapGitHubError({
        status: 429,
        message: 'Too Many Requests',
      });
      expect(result).toBeInstanceOf(RateLimitError);
      expect(result.message).toBe('Too Many Requests');
      expect((result as RateLimitError).retryAfterMs).toBe(60000);
    });
  });

  describe('5xx errors', () => {
    it('should map 500 to GitPlatformError with retryable=true', () => {
      const result = mapGitHubError({
        status: 500,
        message: 'Internal Server Error',
      });
      expect(result).toBeInstanceOf(GitPlatformError);
      expect((result as GitPlatformError).statusCode).toBe(500);
      expect((result as GitPlatformError).retryable).toBe(true);
    });

    it('should map 502 to GitPlatformError with retryable=true', () => {
      const result = mapGitHubError({
        status: 502,
        message: 'Bad Gateway',
      });
      expect(result).toBeInstanceOf(GitPlatformError);
      expect((result as GitPlatformError).statusCode).toBe(502);
      expect((result as GitPlatformError).retryable).toBe(true);
    });

    it('should map 503 to GitPlatformError with retryable=true', () => {
      const result = mapGitHubError({
        status: 503,
        message: 'Service Unavailable',
      });
      expect(result).toBeInstanceOf(GitPlatformError);
      expect((result as GitPlatformError).statusCode).toBe(503);
      expect((result as GitPlatformError).retryable).toBe(true);
    });
  });

  describe('unknown status codes', () => {
    it('should map unknown status to GitPlatformError with retryable=false', () => {
      const result = mapGitHubError({ status: 418, message: "I'm a teapot" });
      expect(result).toBeInstanceOf(GitPlatformError);
      expect((result as GitPlatformError).statusCode).toBe(418);
      expect((result as GitPlatformError).retryable).toBe(false);
    });

    it('should map status 0 for objects without status', () => {
      const result = mapGitHubError({ message: 'no status' });
      expect(result).toBeInstanceOf(GitPlatformError);
      expect((result as GitPlatformError).statusCode).toBe(0);
      expect((result as GitPlatformError).retryable).toBe(false);
    });

    it('should use "Unknown error" when message is missing', () => {
      const result = mapGitHubError({ status: 400 });
      expect(result).toBeInstanceOf(GitPlatformError);
      expect(result.message).toBe('Unknown error');
    });
  });

  describe('extractRetryAfter', () => {
    it('should parse retry-after header from response', () => {
      const result = mapGitHubError({
        status: 429,
        message: 'Too Many Requests',
        response: {
          headers: { 'retry-after': '120' },
        },
      });
      expect(result).toBeInstanceOf(RateLimitError);
      expect((result as RateLimitError).retryAfterMs).toBe(120000);
    });

    it('should default to 60000ms when no response is present', () => {
      const result = mapGitHubError({
        status: 429,
        message: 'Too Many Requests',
      });
      expect(result).toBeInstanceOf(RateLimitError);
      expect((result as RateLimitError).retryAfterMs).toBe(60000);
    });

    it('should default to 60000ms when headers are missing', () => {
      const result = mapGitHubError({
        status: 429,
        message: 'Too Many Requests',
        response: {},
      });
      expect(result).toBeInstanceOf(RateLimitError);
      expect((result as RateLimitError).retryAfterMs).toBe(60000);
    });

    it('should default to 60000ms when retry-after header is not a number', () => {
      const result = mapGitHubError({
        status: 429,
        message: 'Too Many Requests',
        response: {
          headers: { 'retry-after': 'invalid' },
        },
      });
      expect(result).toBeInstanceOf(RateLimitError);
      expect((result as RateLimitError).retryAfterMs).toBe(60000);
    });

    it('should default to 60000ms when retry-after header is absent', () => {
      const result = mapGitHubError({
        status: 429,
        message: 'Too Many Requests',
        response: {
          headers: { 'x-other': 'value' },
        },
      });
      expect(result).toBeInstanceOf(RateLimitError);
      expect((result as RateLimitError).retryAfterMs).toBe(60000);
    });
  });

  describe('error cause preservation', () => {
    it('should preserve cause when input is an Error instance', () => {
      const original = new Error('original failure');
      (original as unknown as { status: number }).status = 500;
      const result = mapGitHubError(original);
      expect(result).toBeInstanceOf(GitPlatformError);
      expect(result.cause).toBe(original);
    });

    it('should not set cause when input is a plain object', () => {
      const result = mapGitHubError({
        status: 404,
        message: 'Not Found',
      });
      expect(result).toBeInstanceOf(NotFoundError);
      expect(result.cause).toBeUndefined();
    });

    it('should preserve cause for AuthenticationError from Error input', () => {
      const original = new Error('auth failed');
      (original as unknown as { status: number }).status = 401;
      const result = mapGitHubError(original);
      expect(result).toBeInstanceOf(AuthenticationError);
      expect(result.cause).toBe(original);
    });

    it('should preserve cause for ValidationError from Error input', () => {
      const original = new Error('validation failed');
      (original as unknown as { status: number }).status = 422;
      const result = mapGitHubError(original);
      expect(result).toBeInstanceOf(ValidationError);
      expect(result.cause).toBe(original);
    });

    it('should preserve cause for RateLimitError from Error input', () => {
      const original = new Error('rate limit exceeded');
      (original as unknown as { status: number }).status = 429;
      const result = mapGitHubError(original);
      expect(result).toBeInstanceOf(RateLimitError);
      expect(result.cause).toBe(original);
    });

    it('should preserve cause for 403 rate limit from Error input', () => {
      const original = new Error('API rate limit exceeded');
      (original as unknown as { status: number }).status = 403;
      const result = mapGitHubError(original);
      expect(result).toBeInstanceOf(RateLimitError);
      expect(result.cause).toBe(original);
    });

    it('should preserve cause for NotFoundError from Error input', () => {
      const original = new Error('not found');
      (original as unknown as { status: number }).status = 404;
      const result = mapGitHubError(original);
      expect(result).toBeInstanceOf(NotFoundError);
      expect(result.cause).toBe(original);
    });
  });
});

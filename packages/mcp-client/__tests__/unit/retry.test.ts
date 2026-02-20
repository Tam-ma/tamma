/**
 * Retry utilities unit tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  withRetry,
  retryable,
  calculateDelay,
  sleep,
  CircuitBreaker,
  DEFAULT_RETRY_OPTIONS,
} from '../../src/utils/retry.js';

describe('Retry Utilities', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('calculateDelay', () => {
    it('should calculate exponential backoff', () => {
      const options = {
        initialDelayMs: 1000,
        maxDelayMs: 30000,
        backoffMultiplier: 2,
        useJitter: false,
      };

      expect(calculateDelay(1, options)).toBe(1000);
      expect(calculateDelay(2, options)).toBe(2000);
      expect(calculateDelay(3, options)).toBe(4000);
      expect(calculateDelay(4, options)).toBe(8000);
    });

    it('should cap at maxDelayMs', () => {
      const options = {
        initialDelayMs: 1000,
        maxDelayMs: 5000,
        backoffMultiplier: 2,
        useJitter: false,
      };

      expect(calculateDelay(10, options)).toBe(5000);
    });

    it('should add jitter when enabled', () => {
      const options = {
        initialDelayMs: 1000,
        maxDelayMs: 30000,
        backoffMultiplier: 2,
        useJitter: true,
      };

      // With jitter, delay should be within 10% of base
      const delays = new Set<number>();
      for (let i = 0; i < 10; i++) {
        delays.add(calculateDelay(1, options));
      }

      // Should have some variation
      expect(delays.size).toBeGreaterThan(1);

      // All delays should be close to 1000
      for (const delay of delays) {
        expect(delay).toBeGreaterThanOrEqual(1000);
        expect(delay).toBeLessThanOrEqual(1100);
      }
    });
  });

  describe('sleep', () => {
    it('should resolve after specified time', async () => {
      const promise = sleep(1000);

      vi.advanceTimersByTime(999);
      await Promise.resolve(); // Flush promises

      vi.advanceTimersByTime(1);
      await expect(promise).resolves.toBeUndefined();
    });

    it('should reject when aborted', async () => {
      const controller = new AbortController();
      const promise = sleep(1000, controller.signal);

      controller.abort();
      await expect(promise).rejects.toThrow('Operation aborted');
    });

    it('should reject immediately if already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      const promise = sleep(1000, controller.signal);
      await expect(promise).rejects.toThrow('Operation aborted');
    });
  });

  describe('withRetry', () => {
    it('should return result on success', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      const result = await withRetry(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockResolvedValue('success');

      const promise = withRetry(fn, {
        maxAttempts: 3,
        initialDelayMs: 100,
        useJitter: false,
      });

      // First attempt fails
      await vi.advanceTimersByTimeAsync(0);

      // Wait for delay and retry
      await vi.advanceTimersByTimeAsync(100);

      // Second attempt fails
      await vi.advanceTimersByTimeAsync(200);

      const result = await promise;
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should throw after max attempts', async () => {
      // Use real timers to avoid unhandled rejection gap from fake timer microtask ordering
      vi.useRealTimers();
      const fn = vi.fn().mockRejectedValue(new Error('always fails'));

      await expect(
        withRetry(fn, { maxAttempts: 3, initialDelayMs: 1, useJitter: false })
      ).rejects.toThrow('always fails');

      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should not retry non-retryable errors', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('validation error'));

      await expect(
        withRetry(fn, {
          maxAttempts: 3,
          isRetryable: (error) => !error.message.includes('validation'),
        })
      ).rejects.toThrow('validation error');

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should call onRetry callback', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');
      const onRetry = vi.fn();

      const promise = withRetry(fn, {
        maxAttempts: 3,
        initialDelayMs: 100,
        useJitter: false,
        onRetry,
      });

      await vi.advanceTimersByTimeAsync(100);
      await promise;

      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error), 100);
    });

    it('should provide context to function', async () => {
      const fn = vi.fn((ctx) => {
        if (ctx.attempt < 2) {
          throw new Error(`Attempt ${ctx.attempt}`);
        }
        return Promise.resolve({ attempt: ctx.attempt, maxAttempts: ctx.maxAttempts });
      });

      const promise = withRetry(fn, {
        maxAttempts: 3,
        initialDelayMs: 100,
        useJitter: false,
      });

      await vi.advanceTimersByTimeAsync(100);
      const result = await promise;

      expect(result).toEqual({ attempt: 2, maxAttempts: 3 });
    });

    it('should abort on signal', async () => {
      const controller = new AbortController();
      // Use synchronous throw to avoid brief unhandled rejection from pre-rejected promises
      const fn = vi.fn().mockImplementation(() => { throw new Error('fail'); });

      const promise = withRetry(fn, {
        maxAttempts: 3,
        initialDelayMs: 100,
        signal: controller.signal,
      });

      // First attempt fails, start waiting for retry
      await vi.advanceTimersByTimeAsync(0);

      // Abort during retry wait — assert immediately to avoid unhandled rejection gap
      controller.abort();
      await expect(promise).rejects.toThrow('Operation aborted');
    });
  });

  describe('retryable', () => {
    it('should create a retryable function', async () => {
      let attempts = 0;
      const fn = async (x: number): Promise<number> => {
        attempts++;
        if (attempts < 2) {
          throw new Error('fail');
        }
        return x * 2;
      };

      const retryableFn = retryable(fn, {
        maxAttempts: 3,
        initialDelayMs: 100,
        useJitter: false,
      });

      const promise = retryableFn(5);
      await vi.advanceTimersByTimeAsync(100);
      const result = await promise;

      expect(result).toBe(10);
      expect(attempts).toBe(2);
    });
  });

  describe('CircuitBreaker', () => {
    it('should start in closed state', () => {
      const cb = new CircuitBreaker();
      expect(cb.getState()).toBe('closed');
      expect(cb.isAllowed()).toBe(true);
    });

    it('should open after failure threshold', () => {
      const cb = new CircuitBreaker({ failureThreshold: 3 });

      cb.recordFailure();
      expect(cb.getState()).toBe('closed');

      cb.recordFailure();
      expect(cb.getState()).toBe('closed');

      cb.recordFailure();
      expect(cb.getState()).toBe('open');
      expect(cb.isAllowed()).toBe(false);
    });

    it('should reset failure count on success', () => {
      const cb = new CircuitBreaker({ failureThreshold: 3 });

      cb.recordFailure();
      cb.recordFailure();
      cb.recordSuccess();

      // Failure count should be reset
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.getState()).toBe('closed');
    });

    it('should transition to half-open after reset timeout', () => {
      const cb = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeoutMs: 1000,
      });

      cb.recordFailure();
      cb.recordFailure();
      expect(cb.getState()).toBe('open');

      vi.advanceTimersByTime(1000);
      expect(cb.getState()).toBe('half-open');
      expect(cb.isAllowed()).toBe(true);
    });

    it('should close after success in half-open state', () => {
      const cb = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeoutMs: 1000,
        successThreshold: 1,
      });

      cb.recordFailure();
      cb.recordFailure();
      vi.advanceTimersByTime(1000);

      expect(cb.getState()).toBe('half-open');

      cb.recordSuccess();
      expect(cb.getState()).toBe('closed');
    });

    it('should reopen on failure in half-open state', () => {
      const cb = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeoutMs: 1000,
      });

      cb.recordFailure();
      cb.recordFailure();
      vi.advanceTimersByTime(1000);

      cb.recordFailure();
      expect(cb.getState()).toBe('open');
    });

    it('should execute function when allowed', async () => {
      const cb = new CircuitBreaker();
      const fn = vi.fn().mockResolvedValue('success');

      const result = await cb.execute(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalled();
    });

    it('should reject when circuit is open', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 1 });
      cb.recordFailure();

      await expect(cb.execute(() => Promise.resolve('test'))).rejects.toThrow(
        'Circuit breaker is open'
      );
    });

    it('should record success/failure from execute', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 2 });

      await cb.execute(() => Promise.resolve('ok'));
      expect(cb.getState()).toBe('closed');

      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();

      expect(cb.getState()).toBe('open');
    });

    it('should reset to initial state', () => {
      const cb = new CircuitBreaker({ failureThreshold: 1 });
      cb.recordFailure();
      expect(cb.getState()).toBe('open');

      cb.reset();
      expect(cb.getState()).toBe('closed');
      expect(cb.isAllowed()).toBe(true);
    });
  });
});

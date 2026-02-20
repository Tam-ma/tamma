import { describe, it, expect, vi } from 'vitest';
import { withRateLimit } from '../github/github-rate-limiter.js';

describe('withRateLimit', () => {
  it('should return result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRateLimit(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on 429 errors', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ status: 429, message: 'Too Many Requests' })
      .mockResolvedValue('ok');

    const result = await withRateLimit(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should retry on rate limit 403 errors', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({
        status: 403,
        message: 'API rate limit exceeded',
      })
      .mockResolvedValue('ok');

    const result = await withRateLimit(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should retry on 502 errors', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ status: 502, message: 'Bad Gateway' })
      .mockResolvedValue('ok');

    const result = await withRateLimit(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should retry on 503 errors', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ status: 503, message: 'Service Unavailable' })
      .mockResolvedValue('ok');

    const result = await withRateLimit(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should retry on 504 errors', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ status: 504, message: 'Gateway Timeout' })
      .mockResolvedValue('ok');

    const result = await withRateLimit(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should not retry non-retryable errors', async () => {
    const fn = vi
      .fn()
      .mockRejectedValue({ status: 404, message: 'Not Found' });

    await expect(withRateLimit(fn)).rejects.toEqual(
      expect.objectContaining({ status: 404 }),
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should throw after max retries', async () => {
    const fn = vi
      .fn()
      .mockRejectedValue({ status: 429, message: 'Too Many Requests' });

    await expect(withRateLimit(fn)).rejects.toEqual(
      expect.objectContaining({ status: 429 }),
    );
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

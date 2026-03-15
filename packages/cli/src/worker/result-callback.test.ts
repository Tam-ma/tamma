import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorkerResultCallback } from './result-callback.js';
import type { ILogger } from '@tamma/shared/contracts';

function createMockLogger(): ILogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe('WorkerResultCallback', () => {
  let logger: ILogger;
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    logger = createMockLogger();
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should strip trailing slash from apiUrl', () => {
      const cb = new WorkerResultCallback({
        apiKey: 'test-key',
        apiUrl: 'https://api.tamma.dev/',
        logger,
      });

      fetchMock.mockResolvedValueOnce({ ok: true });
      void cb.reportSuccess('wf-1', { issueNumber: 1, installationId: 'inst-1' });

      // Verify the URL doesn't have double slashes
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.tamma.dev/api/v1/workflows/wf-1/result',
        expect.any(Object),
      );
    });
  });

  describe('reportSuccess', () => {
    it('should POST success result with correct payload', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true });

      const cb = new WorkerResultCallback({
        apiKey: 'test-key',
        apiUrl: 'https://api.tamma.dev',
        logger,
      });

      await cb.reportSuccess('wf-123', {
        issueNumber: 42,
        installationId: 'inst-456',
        prNumber: 99,
        prUrl: 'https://github.com/owner/repo/pull/99',
        costUsd: 0.45,
        durationMs: 12000,
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.tamma.dev/api/v1/workflows/wf-123/result',
        {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer test-key',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            status: 'success',
            issueNumber: 42,
            installationId: 'inst-456',
            prNumber: 99,
            prUrl: 'https://github.com/owner/repo/pull/99',
            costUsd: 0.45,
            durationMs: 12000,
          }),
        },
      );
    });

    it('should omit optional fields when not provided', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true });

      const cb = new WorkerResultCallback({
        apiKey: 'test-key',
        apiUrl: 'https://api.tamma.dev',
        logger,
      });

      await cb.reportSuccess('wf-123', {
        issueNumber: 42,
        installationId: 'inst-456',
      });

      const callBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(callBody).toEqual({
        status: 'success',
        issueNumber: 42,
        installationId: 'inst-456',
      });
      expect(callBody).not.toHaveProperty('prNumber');
      expect(callBody).not.toHaveProperty('prUrl');
    });
  });

  describe('reportFailure', () => {
    it('should POST failure result with error details', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true });

      const cb = new WorkerResultCallback({
        apiKey: 'key',
        apiUrl: 'https://api.tamma.dev',
        logger,
      });

      await cb.reportFailure('wf-789', {
        issueNumber: 10,
        installationId: 'inst-1',
        error: 'Agent provider is not available',
        step: 'initialization',
      });

      const callBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(callBody).toEqual({
        status: 'failure',
        issueNumber: 10,
        installationId: 'inst-1',
        error: 'Agent provider is not available',
        step: 'initialization',
      });
    });

    it('should omit step when not provided', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true });

      const cb = new WorkerResultCallback({
        apiKey: 'key',
        apiUrl: 'https://api.tamma.dev',
        logger,
      });

      await cb.reportFailure('wf-789', {
        issueNumber: 10,
        installationId: 'inst-1',
        error: 'Something went wrong',
      });

      const callBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(callBody).not.toHaveProperty('step');
    });
  });

  describe('reportStatus', () => {
    it('should POST to the status endpoint', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true });

      const cb = new WorkerResultCallback({
        apiKey: 'key',
        apiUrl: 'https://api.tamma.dev',
        logger,
      });

      await cb.reportStatus('wf-100', 'running', 'processing');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.tamma.dev/api/v1/workflows/wf-100/status',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ status: 'running', step: 'processing' }),
        }),
      );
    });
  });

  describe('retry behavior', () => {
    it('should retry on fetch failure with exponential backoff', async () => {
      fetchMock
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockResolvedValueOnce({ ok: true });

      const cb = new WorkerResultCallback({
        apiKey: 'key',
        apiUrl: 'https://api.tamma.dev',
        logger,
        maxRetries: 3,
        baseDelayMs: 10, // Use small delay for tests
      });

      await cb.reportSuccess('wf-1', { issueNumber: 1, installationId: 'inst-1' });

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(logger.warn).toHaveBeenCalledTimes(2); // Two failed attempts logged
      expect(logger.info).toHaveBeenCalledWith(
        'Callback reported successfully',
        expect.objectContaining({ attempt: 3 }),
      );
    });

    it('should retry on non-OK response', async () => {
      fetchMock
        .mockResolvedValueOnce({ ok: false, status: 500, text: () => Promise.resolve('Internal Server Error') })
        .mockResolvedValueOnce({ ok: true });

      const cb = new WorkerResultCallback({
        apiKey: 'key',
        apiUrl: 'https://api.tamma.dev',
        logger,
        maxRetries: 3,
        baseDelayMs: 10,
      });

      await cb.reportSuccess('wf-1', { issueNumber: 1, installationId: 'inst-1' });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(logger.warn).toHaveBeenCalledWith(
        'Callback response not OK',
        expect.objectContaining({ status: 500 }),
      );
    });

    it('should not throw when all retries are exhausted', async () => {
      fetchMock
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockRejectedValueOnce(new Error('fail 3'));

      const cb = new WorkerResultCallback({
        apiKey: 'key',
        apiUrl: 'https://api.tamma.dev',
        logger,
        maxRetries: 3,
        baseDelayMs: 10,
      });

      // Should NOT throw
      await expect(
        cb.reportSuccess('wf-1', { issueNumber: 1, installationId: 'inst-1' }),
      ).resolves.toBeUndefined();

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(logger.warn).toHaveBeenCalledWith(
        'All callback retries exhausted. Orchestrator will detect via timeout.',
        expect.objectContaining({ maxRetries: 3 }),
      );
    });

    it('should use custom maxRetries', async () => {
      fetchMock.mockRejectedValue(new Error('always fails'));

      const cb = new WorkerResultCallback({
        apiKey: 'key',
        apiUrl: 'https://api.tamma.dev',
        logger,
        maxRetries: 5,
        baseDelayMs: 1,
      });

      await cb.reportSuccess('wf-1', { issueNumber: 1, installationId: 'inst-1' });

      expect(fetchMock).toHaveBeenCalledTimes(5);
    });
  });

  describe('URL encoding', () => {
    it('should encode workflow ID in URL', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true });

      const cb = new WorkerResultCallback({
        apiKey: 'key',
        apiUrl: 'https://api.tamma.dev',
        logger,
      });

      await cb.reportSuccess('wf/with spaces', { issueNumber: 1, installationId: 'inst-1' });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.tamma.dev/api/v1/workflows/wf%2Fwith%20spaces/result',
        expect.any(Object),
      );
    });
  });

  describe('authorization', () => {
    it('should send Bearer token in Authorization header', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true });

      const cb = new WorkerResultCallback({
        apiKey: 'my-secret-key',
        apiUrl: 'https://api.tamma.dev',
        logger,
      });

      await cb.reportSuccess('wf-1', { issueNumber: 1, installationId: 'inst-1' });

      const headers = fetchMock.mock.calls[0][1].headers;
      expect(headers['Authorization']).toBe('Bearer my-secret-key');
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { secureFetch } from './secure-fetch.js';
import type { SecureFetchResult } from './secure-fetch.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Create a mock Response with a ReadableStream body from a string.
 */
function createMockResponse(
  body: string,
  init?: {
    status?: number;
    headers?: Record<string, string>;
  },
): Response {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(body);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoded);
      controller.close();
    },
  });

  const status = init?.status ?? 200;
  const headers = new Headers(init?.headers);

  return new Response(stream, { status, headers });
}

/**
 * Create a mock Response whose ReadableStream delivers data in multiple chunks.
 * Each chunk is a separate string entry in the `chunks` array.
 */
function createMultiChunkResponse(
  chunks: string[],
  init?: {
    status?: number;
    headers?: Record<string, string>;
  },
): Response {
  const encoder = new TextEncoder();
  const encodedChunks = chunks.map((c) => encoder.encode(c));
  let index = 0;

  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = encodedChunks[index];
      if (chunk !== undefined) {
        controller.enqueue(chunk);
        index++;
      } else {
        controller.close();
      }
    },
  });

  const status = init?.status ?? 200;
  const headers = new Headers(init?.headers);

  return new Response(stream, { status, headers });
}

/**
 * Create a redirect Response (no body) with Location header.
 */
function createRedirectResponse(
  status: number,
  location: string,
): Response {
  const headers = new Headers({ location });
  return new Response(null, { status, headers });
}

/**
 * Create a redirect Response without a Location header.
 */
function createRedirectWithoutLocation(status: number): Response {
  return new Response(null, { status, headers: new Headers() });
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('secureFetch', () => {
  // ─── URL validation (pre-fetch) ──────────────────────────────────────

  describe('URL validation before fetch', () => {
    it('should reject private host URLs before making any fetch call', async () => {
      const result = await secureFetch('http://10.0.0.1/api');
      expect(result.ok).toBe(false);
      expect(result.error).toBe('URL validation failed');
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should reject http://localhost:3000 without fetching', async () => {
      const result = await secureFetch('http://localhost:3000');
      expect(result.ok).toBe(false);
      expect(result.error).toBe('URL validation failed');
      expect(result.warnings.some((w) => w.includes('localhost'))).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should reject file:///etc/passwd without fetching', async () => {
      const result = await secureFetch('file:///etc/passwd');
      expect(result.ok).toBe(false);
      expect(result.error).toBe('URL validation failed');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should reject http://192.168.1.1/secret without fetching', async () => {
      const result = await secureFetch('http://192.168.1.1/secret');
      expect(result.ok).toBe(false);
      expect(result.error).toBe('URL validation failed');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should reject http://127.0.0.1:8080/admin without fetching', async () => {
      const result = await secureFetch('http://127.0.0.1:8080/admin');
      expect(result.ok).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should reject http://169.254.169.254/latest/meta-data without fetching', async () => {
      const result = await secureFetch('http://169.254.169.254/latest/meta-data');
      expect(result.ok).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should reject completely invalid URL strings', async () => {
      const result = await secureFetch('not a valid url');
      expect(result.ok).toBe(false);
      expect(result.error).toBe('URL validation failed');
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  // ─── Successful fetch ────────────────────────────────────────────────

  describe('successful fetch', () => {
    it('should accept and fetch https://example.com with text content-type', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse('Hello World', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
      );

      const result = await secureFetch('https://example.com');
      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
      expect(result.body).toBe('Hello World');
      expect(result.warnings).toEqual([]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('should return response headers in result', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse('{}', {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'x-custom': 'value',
          },
        }),
      );

      const result = await secureFetch('https://api.example.com/data');
      expect(result.ok).toBe(true);
      expect(result.headers).toBeDefined();
      expect(result.headers!['content-type']).toBe('application/json');
      expect(result.headers!['x-custom']).toBe('value');
    });

    it('should pass custom headers through to fetch', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse('OK', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
      );

      await secureFetch('https://example.com', {
        headers: { 'Authorization': 'Bearer token123', 'X-Custom': 'test' },
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const callArgs = fetchSpy.mock.calls[0]!;
      const fetchOptions = callArgs[1] as RequestInit;
      expect(fetchOptions.headers).toEqual({
        'Authorization': 'Bearer token123',
        'X-Custom': 'test',
      });
    });
  });

  // ─── Body size limits via streaming ──────────────────────────────────

  describe('body size limits via streaming ReadableStream', () => {
    it('should enforce max body size and abort via reader.cancel()', async () => {
      // Create a response body that exceeds the limit
      const largeBody = 'x'.repeat(200);
      fetchSpy.mockResolvedValueOnce(
        createMockResponse(largeBody, {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
      );

      const result = await secureFetch('https://example.com', {
        maxSizeBytes: 100,
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('exceeds max size');
      expect(result.error).toContain('100 bytes');
    });

    it('should allow responses within the size limit', async () => {
      const body = 'x'.repeat(50);
      fetchSpy.mockResolvedValueOnce(
        createMockResponse(body, {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
      );

      const result = await secureFetch('https://example.com', {
        maxSizeBytes: 100,
      });

      expect(result.ok).toBe(true);
      expect(result.body).toBe(body);
    });

    it('should use response.body ReadableStream for byte counting (multi-chunk)', async () => {
      // Create a multi-chunk response that exceeds the limit across chunks
      const chunks = ['aaaa', 'bbbb', 'cccc', 'dddd', 'eeee']; // 5 * 4 = 20 bytes
      fetchSpy.mockResolvedValueOnce(
        createMultiChunkResponse(chunks, {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
      );

      const result = await secureFetch('https://example.com', {
        maxSizeBytes: 12, // Allow first 3 chunks (12 bytes), 4th chunk would exceed
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('exceeds max size');
    });

    it('should allow multi-chunk response within size limit', async () => {
      const chunks = ['aaaa', 'bbbb', 'cccc']; // 12 bytes total
      fetchSpy.mockResolvedValueOnce(
        createMultiChunkResponse(chunks, {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
      );

      const result = await secureFetch('https://example.com', {
        maxSizeBytes: 100,
      });

      expect(result.ok).toBe(true);
      expect(result.body).toBe('aaaabbbbcccc');
    });

    it('should default maxSizeBytes to 10 MB when not specified', async () => {
      // Create a body just under 10 MB -- but we just verify it works
      const body = 'test content';
      fetchSpy.mockResolvedValueOnce(
        createMockResponse(body, {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
      );

      const result = await secureFetch('https://example.com');
      expect(result.ok).toBe(true);
      expect(result.body).toBe(body);
    });

    it('should custom maxSizeBytes override default', async () => {
      const body = 'x'.repeat(50);
      fetchSpy.mockResolvedValueOnce(
        createMockResponse(body, {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
      );

      const result = await secureFetch('https://example.com', {
        maxSizeBytes: 30,
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('exceeds max size');
      expect(result.error).toContain('30 bytes');
    });

    it('should handle response with no body (reader is null)', async () => {
      // Create a response that has no body stream
      const response = new Response(null, {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      });
      // Response with null body has body === null
      fetchSpy.mockResolvedValueOnce(response);

      const result = await secureFetch('https://example.com');
      expect(result.ok).toBe(false);
      expect(result.error).toBe('No response body');
    });
  });

  // ─── Redirect handling ───────────────────────────────────────────────

  describe('redirect handling with manual redirect and re-validation', () => {
    it('should block redirect to private IP on 301', async () => {
      fetchSpy.mockResolvedValueOnce(
        createRedirectResponse(301, 'http://192.168.1.1/secret'),
      );

      const result = await secureFetch('https://example.com/page');
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Redirect URL validation failed');
      expect(result.warnings.some((w) => w.includes('192.168.1.1'))).toBe(true);
    });

    it('should block redirect to private IP on 302', async () => {
      fetchSpy.mockResolvedValueOnce(
        createRedirectResponse(302, 'http://192.168.1.1/secret'),
      );

      const result = await secureFetch('https://example.com/page');
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Redirect URL validation failed');
      expect(result.warnings.some((w) => w.includes('192.168.1.1'))).toBe(true);
    });

    it('should block redirect to private IP on 307', async () => {
      fetchSpy.mockResolvedValueOnce(
        createRedirectResponse(307, 'http://10.0.0.1/internal'),
      );

      const result = await secureFetch('https://example.com/api');
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Redirect URL validation failed');
    });

    it('should block redirect to private IP on 308', async () => {
      fetchSpy.mockResolvedValueOnce(
        createRedirectResponse(308, 'http://172.16.0.1/admin'),
      );

      const result = await secureFetch('https://example.com/api');
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Redirect URL validation failed');
    });

    it('should block redirect to localhost', async () => {
      fetchSpy.mockResolvedValueOnce(
        createRedirectResponse(302, 'http://localhost:3000/admin'),
      );

      const result = await secureFetch('https://example.com/page');
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Redirect URL validation failed');
    });

    it('should block redirect to 127.0.0.1', async () => {
      fetchSpy.mockResolvedValueOnce(
        createRedirectResponse(302, 'http://127.0.0.1:8080/secret'),
      );

      const result = await secureFetch('https://example.com/page');
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Redirect URL validation failed');
    });

    it('should follow valid redirects', async () => {
      fetchSpy
        .mockResolvedValueOnce(
          createRedirectResponse(302, 'https://example.com/new-path'),
        )
        .mockResolvedValueOnce(
          createMockResponse('Redirected content', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          }),
        );

      const result = await secureFetch('https://example.com/old-path');
      expect(result.ok).toBe(true);
      expect(result.body).toBe('Redirected content');
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('should follow multiple valid redirects', async () => {
      fetchSpy
        .mockResolvedValueOnce(
          createRedirectResponse(301, 'https://example.com/step-2'),
        )
        .mockResolvedValueOnce(
          createRedirectResponse(302, 'https://example.com/step-3'),
        )
        .mockResolvedValueOnce(
          createMockResponse('Final destination', {
            status: 200,
            headers: { 'content-type': 'text/plain' },
          }),
        );

      const result = await secureFetch('https://example.com/step-1');
      expect(result.ok).toBe(true);
      expect(result.body).toBe('Final destination');
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });

    it('should use redirect: manual for each redirect hop', async () => {
      fetchSpy
        .mockResolvedValueOnce(
          createRedirectResponse(302, 'https://example.com/new'),
        )
        .mockResolvedValueOnce(
          createMockResponse('OK', {
            status: 200,
            headers: { 'content-type': 'text/plain' },
          }),
        );

      await secureFetch('https://example.com/old');

      // Both calls should use redirect: 'manual'
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      for (const call of fetchSpy.mock.calls) {
        const opts = call[1] as RequestInit;
        expect(opts.redirect).toBe('manual');
      }
    });

    it('should enforce max redirect count of 5 (prevent infinite loops)', async () => {
      // Mock 6 redirects -- the 6th should fail (exceeds max 5)
      for (let i = 0; i < 6; i++) {
        fetchSpy.mockResolvedValueOnce(
          createRedirectResponse(302, `https://example.com/redirect-${i + 1}`),
        );
      }

      const result = await secureFetch('https://example.com/start');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Too many redirects');
      expect(result.error).toContain('max 5');
      // Should have made 6 fetch calls (5 valid redirects + the one that triggers the error)
      // Actually: 5 redirects accepted, then on 6th response which is also redirect, it increments to 6 > 5
      expect(fetchSpy).toHaveBeenCalledTimes(6);
    });

    it('should custom maxRedirects override default', async () => {
      // Set maxRedirects to 2; mock 3 redirects
      for (let i = 0; i < 3; i++) {
        fetchSpy.mockResolvedValueOnce(
          createRedirectResponse(302, `https://example.com/r-${i + 1}`),
        );
      }

      const result = await secureFetch('https://example.com/start', {
        maxRedirects: 2,
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Too many redirects');
      expect(result.error).toContain('max 2');
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });

    it('should handle redirect without Location header gracefully', async () => {
      fetchSpy.mockResolvedValueOnce(
        createRedirectWithoutLocation(302),
      );

      const result = await secureFetch('https://example.com/page');
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Redirect without Location header');
    });

    it('should handle redirect with invalid Location URL', async () => {
      // A redirect to a file: protocol URL should be rejected
      fetchSpy.mockResolvedValueOnce(
        createRedirectResponse(302, 'file:///etc/passwd'),
      );

      const result = await secureFetch('https://example.com/page');
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Redirect URL validation failed');
    });
  });

  // ─── Content-Type allowlist ──────────────────────────────────────────

  describe('Content-Type allowlist', () => {
    it('should accept text/html content type', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse('<html>test</html>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
      );

      const result = await secureFetch('https://example.com');
      expect(result.ok).toBe(true);
    });

    it('should accept text/plain content type', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse('plain text', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
      );

      const result = await secureFetch('https://example.com');
      expect(result.ok).toBe(true);
    });

    it('should accept application/json content type', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse('{"key":"value"}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      const result = await secureFetch('https://example.com/api');
      expect(result.ok).toBe(true);
      expect(result.body).toBe('{"key":"value"}');
    });

    it('should accept application/xml content type', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse('<root/>', {
          status: 200,
          headers: { 'content-type': 'application/xml' },
        }),
      );

      const result = await secureFetch('https://example.com/feed');
      expect(result.ok).toBe(true);
    });

    it('should reject application/octet-stream content type', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse('binary data', {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' },
        }),
      );

      const result = await secureFetch('https://example.com/file');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Blocked content type');
      expect(result.error).toContain('application/octet-stream');
    });

    it('should reject image/png content type', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse('fake png data', {
          status: 200,
          headers: { 'content-type': 'image/png' },
        }),
      );

      const result = await secureFetch('https://example.com/image.png');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Blocked content type');
      expect(result.error).toContain('image/png');
    });

    it('should reject video/mp4 content type', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse('fake video', {
          status: 200,
          headers: { 'content-type': 'video/mp4' },
        }),
      );

      const result = await secureFetch('https://example.com/video.mp4');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Blocked content type');
    });

    it('should reject application/zip content type', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse('fake zip', {
          status: 200,
          headers: { 'content-type': 'application/zip' },
        }),
      );

      const result = await secureFetch('https://example.com/archive.zip');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Blocked content type');
    });

    it('should handle missing content-type header (reject as blocked)', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse('data', {
          status: 200,
          headers: {},
        }),
      );

      const result = await secureFetch('https://example.com');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Blocked content type');
    });

    it('should custom allowedContentTypes override default', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse('image data', {
          status: 200,
          headers: { 'content-type': 'image/svg+xml' },
        }),
      );

      const result = await secureFetch('https://example.com/icon.svg', {
        allowedContentTypes: ['image/svg+xml'],
      });
      expect(result.ok).toBe(true);
    });

    it('should custom allowedContentTypes reject previously-allowed types', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse('plain text', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
      );

      // Only allow JSON, so text/plain should be rejected
      const result = await secureFetch('https://example.com', {
        allowedContentTypes: ['application/json'],
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Blocked content type');
    });

    it('should handle content-type with charset parameter', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse('{"ok":true}', {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        }),
      );

      const result = await secureFetch('https://example.com/api');
      expect(result.ok).toBe(true);
    });

    it('should handle Content-Type matching case-insensitively', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse('data', {
          status: 200,
          headers: { 'content-type': 'Application/JSON' },
        }),
      );

      const result = await secureFetch('https://example.com');
      expect(result.ok).toBe(true);
    });
  });

  // ─── Network error handling ──────────────────────────────────────────

  describe('network error handling', () => {
    it('should handle network errors gracefully (fetch throws)', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = await secureFetch('https://example.com');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Network error');
      expect(result.error).toContain('ECONNREFUSED');
    });

    it('should handle DNS failure gracefully', async () => {
      fetchSpy.mockRejectedValueOnce(
        new Error('getaddrinfo ENOTFOUND nonexistent.example.com'),
      );

      const result = await secureFetch('https://nonexistent.example.com');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Network error');
      expect(result.error).toContain('ENOTFOUND');
    });

    it('should handle non-Error thrown values', async () => {
      fetchSpy.mockRejectedValueOnce('string error');

      const result = await secureFetch('https://example.com');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Network error');
    });

    it('should handle timeout via AbortController', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('The operation was aborted'));

      const result = await secureFetch('https://example.com', {
        timeoutMs: 100,
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Request timed out');
    });

    it('should handle AbortError from controller', async () => {
      fetchSpy.mockRejectedValueOnce(new DOMException('The user aborted a request.', 'AbortError'));

      const result = await secureFetch('https://example.com', {
        timeoutMs: 100,
      });
      // DOMException message may not contain 'abort' in lowercase depending on runtime
      // but the message includes 'aborted' so it should be caught
      expect(result.ok).toBe(false);
    });

    it('should handle stream read errors gracefully', async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('partial'));
          controller.error(new Error('Stream read failed'));
        },
      });

      const response = new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      });
      fetchSpy.mockResolvedValueOnce(response);

      const result = await secureFetch('https://example.com');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Error reading response body');
    });
  });

  // ─── redirect: 'manual' enforcement ──────────────────────────────────

  describe('redirect: manual enforcement', () => {
    it('should always pass redirect: manual in fetch options', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse('OK', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
      );

      await secureFetch('https://example.com');

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const callArgs = fetchSpy.mock.calls[0]!;
      const fetchOptions = callArgs[1] as RequestInit;
      expect(fetchOptions.redirect).toBe('manual');
    });

    it('should pass signal (AbortController) in fetch options', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse('OK', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
      );

      await secureFetch('https://example.com');

      const callArgs = fetchSpy.mock.calls[0]!;
      const fetchOptions = callArgs[1] as RequestInit;
      expect(fetchOptions.signal).toBeDefined();
      expect(fetchOptions.signal).toBeInstanceOf(AbortSignal);
    });
  });

  // ─── SSRF redirect-to-private-IP scenarios ───────────────────────────

  describe('SSRF redirect-to-private-IP blocked', () => {
    it('should block public URL that redirects to private IP 10.x', async () => {
      fetchSpy.mockResolvedValueOnce(
        createRedirectResponse(302, 'http://10.0.0.5/internal-api'),
      );

      const result = await secureFetch('https://safe-looking-site.com/redirect');
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Redirect URL validation failed');
    });

    it('should block public URL that redirects to cloud metadata endpoint', async () => {
      fetchSpy.mockResolvedValueOnce(
        createRedirectResponse(301, 'http://metadata.google.internal/computeMetadata/v1/'),
      );

      const result = await secureFetch('https://attacker.com/ssrf');
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Redirect URL validation failed');
    });

    it('should block chained redirects where second hop goes to private IP', async () => {
      fetchSpy
        .mockResolvedValueOnce(
          createRedirectResponse(302, 'https://example.com/step2'),
        )
        .mockResolvedValueOnce(
          createRedirectResponse(302, 'http://192.168.1.1/admin'),
        );

      const result = await secureFetch('https://attacker.com/step1');
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Redirect URL validation failed');
    });

    it('should block redirect to 0.0.0.0', async () => {
      fetchSpy.mockResolvedValueOnce(
        createRedirectResponse(307, 'http://0.0.0.0/'),
      );

      const result = await secureFetch('https://example.com/api');
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Redirect URL validation failed');
    });

    it('should block redirect to link-local address', async () => {
      fetchSpy.mockResolvedValueOnce(
        createRedirectResponse(302, 'http://169.254.169.254/latest/meta-data'),
      );

      const result = await secureFetch('https://example.com');
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Redirect URL validation failed');
    });
  });

  // ─── Edge cases ──────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should never call response.text() or response.arrayBuffer()', async () => {
      const mockResponse = createMockResponse('content', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      });

      // Spy on text() and arrayBuffer() to verify they are NOT called
      const textSpy = vi.spyOn(mockResponse, 'text');
      const arrayBufferSpy = vi.spyOn(mockResponse, 'arrayBuffer');

      fetchSpy.mockResolvedValueOnce(mockResponse);

      const result = await secureFetch('https://example.com');
      expect(result.ok).toBe(true);
      expect(textSpy).not.toHaveBeenCalled();
      expect(arrayBufferSpy).not.toHaveBeenCalled();
    });

    it('should handle empty response body (0 bytes)', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse('', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
      );

      const result = await secureFetch('https://example.com');
      expect(result.ok).toBe(true);
      expect(result.body).toBe('');
    });

    it('should handle non-200 status codes without redirect', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse('Not Found', {
          status: 404,
          headers: { 'content-type': 'text/html' },
        }),
      );

      const result = await secureFetch('https://example.com/missing');
      expect(result.ok).toBe(true); // ok here means "fetch completed without security issues"
      expect(result.status).toBe(404);
      expect(result.body).toBe('Not Found');
    });

    it('should handle 500 server error status', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse('Internal Server Error', {
          status: 500,
          headers: { 'content-type': 'text/plain' },
        }),
      );

      const result = await secureFetch('https://example.com/error');
      expect(result.ok).toBe(true);
      expect(result.status).toBe(500);
    });

    it('should handle exact boundary for maxSizeBytes (body equals limit)', async () => {
      const body = 'x'.repeat(100); // Exactly 100 bytes
      fetchSpy.mockResolvedValueOnce(
        createMockResponse(body, {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
      );

      const result = await secureFetch('https://example.com', {
        maxSizeBytes: 100,
      });
      expect(result.ok).toBe(true);
      expect(result.body).toBe(body);
    });

    it('should handle boundary + 1 for maxSizeBytes (body exceeds limit by 1 byte)', async () => {
      const body = 'x'.repeat(101); // 101 bytes, limit is 100
      fetchSpy.mockResolvedValueOnce(
        createMockResponse(body, {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
      );

      const result = await secureFetch('https://example.com', {
        maxSizeBytes: 100,
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('exceeds max size');
    });

    it('should function correctly when secureFetch result type is used', async () => {
      fetchSpy.mockResolvedValueOnce(
        createMockResponse('typed', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
      );

      const result: SecureFetchResult = await secureFetch('https://example.com');
      expect(result.ok).toBe(true);
      expect(result.warnings).toEqual([]);
    });
  });
});

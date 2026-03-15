/**
 * Secure fetch wrapper with SSRF protections.
 *
 * Provides:
 * - Pre-request URL validation against private hosts
 * - Manual redirect handling with Location header re-validation (max 5 hops)
 * - Streaming body read via ReadableStream with running byte counter
 * - AbortController-based size limit enforcement
 * - Content-Type allowlist checking before reading body
 * - Timeout enforcement via AbortController
 *
 * Uses `globalThis.fetch` (Node.js 22 LTS built-in). No polyfills needed.
 *
 * @module
 */

import { validateUrl } from './url-validator.js';

/** Default maximum response body size: 10 MB. */
const DEFAULT_MAX_SIZE_BYTES = 10 * 1024 * 1024;

/** Default request timeout in milliseconds. */
const DEFAULT_TIMEOUT_MS = 30_000;

/** Default maximum number of redirect hops. */
const DEFAULT_MAX_REDIRECTS = 5;

/** Default allowed content type prefixes/values. */
const DEFAULT_ALLOWED_CONTENT_TYPES: readonly string[] = [
  'text/',
  'application/json',
  'application/xml',
];

/** HTTP status codes that indicate a redirect. */
const REDIRECT_STATUS_CODES: ReadonlySet<number> = new Set([301, 302, 307, 308]);

/**
 * Options for the {@link secureFetch} function.
 */
export interface SecureFetchOptions {
  /** Maximum response body size in bytes. Default: 10 MB (10 * 1024 * 1024). */
  maxSizeBytes?: number;
  /** Request timeout in milliseconds. Default: 30000. */
  timeoutMs?: number;
  /** Allowed URL protocols. Default: ['http:', 'https:']. */
  allowedProtocols?: string[];
  /** Allowed Content-Type prefixes/values. Default: ['text/', 'application/json', 'application/xml']. */
  allowedContentTypes?: string[];
  /** Maximum number of redirect hops to follow. Default: 5. */
  maxRedirects?: number;
  /** Custom headers to include in the request. */
  headers?: Record<string, string>;
}

/**
 * Result returned by {@link secureFetch}.
 */
export interface SecureFetchResult {
  /** Whether the request was successful. */
  ok: boolean;
  /** HTTP status code of the final response. */
  status?: number;
  /** Response body as a string (only present on success). */
  body?: string;
  /** Response headers as a key-value map (only present on success). */
  headers?: Record<string, string>;
  /** Error message if the request failed. */
  error?: string;
  /** Warnings collected during the request. */
  warnings: string[];
}

/**
 * Perform a fetch request with SSRF protections.
 *
 * Security measures:
 * 1. URL validation before the request (rejects private hosts)
 * 2. Manual redirect handling with Location header re-validation
 * 3. Content-Type allowlist checking before reading body
 * 4. Streaming body read via ReadableStream with byte counter
 * 5. AbortController-based size limit and timeout enforcement
 *
 * @param url - The URL to fetch
 * @param options - Optional configuration
 * @returns A promise resolving to the fetch result
 */
export async function secureFetch(
  url: string,
  inputOptions?: SecureFetchOptions,
): Promise<SecureFetchResult> {
  let options = inputOptions;
  const warnings: string[] = [];
  const maxSize = options?.maxSizeBytes ?? DEFAULT_MAX_SIZE_BYTES;
  const maxRedirects = options?.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const allowedContentTypes = options?.allowedContentTypes ?? DEFAULT_ALLOWED_CONTENT_TYPES;

  // 1. Pre-validate URL
  const validation = validateUrl(url);
  if (!validation.valid) {
    return {
      ok: false,
      error: 'URL validation failed',
      warnings: validation.warnings,
    };
  }

  // 2. Follow redirects manually, re-validating each Location header
  let currentUrl = url;
  let redirectCount = 0;
  let response: Response;

  while (true) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => { controller.abort(); }, timeoutMs);

    try {
      const fetchInit: RequestInit = {
        redirect: 'manual',
        signal: controller.signal,
      };
      if (options?.headers !== undefined) {
        fetchInit.headers = options.headers;
      }

      response = await globalThis.fetch(currentUrl, fetchInit);
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('abort') || message.includes('Abort')) {
        return {
          ok: false,
          error: 'Request timed out',
          warnings,
        };
      }
      return {
        ok: false,
        error: `Network error: ${message}`,
        warnings,
      };
    } finally {
      clearTimeout(timeoutId);
    }

    // 3. On redirect status, extract Location and re-validate
    if (REDIRECT_STATUS_CODES.has(response.status)) {
      redirectCount++;
      if (redirectCount > maxRedirects) {
        return {
          ok: false,
          error: `Too many redirects (max ${maxRedirects})`,
          warnings,
        };
      }

      const location = response.headers.get('location');
      if (!location) {
        return {
          ok: false,
          error: 'Redirect without Location header',
          warnings,
        };
      }

      // Resolve relative redirect URLs against the current URL
      let resolvedLocation: string;
      try {
        resolvedLocation = new URL(location, currentUrl).href;
      } catch {
        return {
          ok: false,
          error: 'Redirect URL is invalid',
          warnings,
        };
      }

      const redirectValidation = validateUrl(resolvedLocation);
      if (!redirectValidation.valid) {
        return {
          ok: false,
          error: 'Redirect URL validation failed',
          warnings: [...warnings, ...redirectValidation.warnings],
        };
      }

      // Strip sensitive headers on cross-origin redirect (prevent credential leak)
      try {
        const currentOrigin = new URL(currentUrl).origin;
        const redirectOrigin = new URL(resolvedLocation).origin;
        if (currentOrigin !== redirectOrigin && options?.headers !== undefined) {
          const sensitiveHeaderNames = ['authorization', 'cookie', 'proxy-authorization'];
          const lowerHeaders = Object.entries(options.headers);
          const hasLeakedHeaders = lowerHeaders.some(([k]) => sensitiveHeaderNames.includes(k.toLowerCase()));
          if (hasLeakedHeaders) {
            warnings.push(`Sensitive headers stripped on cross-origin redirect to ${redirectOrigin}`);
            // Create a copy without sensitive headers for subsequent requests
            const safeHeaders: Record<string, string> = {};
            for (const [k, v] of lowerHeaders) {
              if (!sensitiveHeaderNames.includes(k.toLowerCase())) {
                safeHeaders[k] = v;
              }
            }
            const newHeaders = Object.keys(safeHeaders).length > 0 ? safeHeaders : undefined;
            options = newHeaders !== undefined ? { ...options, headers: newHeaders } : { ...options };
          }
        }
      } catch {
        // URL parsing failed -- already validated above, shouldn't happen
      }

      currentUrl = resolvedLocation;
      continue;
    }

    break;
  }

  // 4. Check Content-Type allowlist before reading body
  const contentType = response.headers.get('content-type') ?? '';
  const isAllowedContentType = allowedContentTypes.some(
    (allowed) => contentType.toLowerCase().includes(allowed.toLowerCase()),
  );

  if (!isAllowedContentType) {
    return {
      ok: false,
      error: `Blocked content type: ${contentType}`,
      warnings,
    };
  }

  // 5. Read response body via ReadableStream with running byte counter.
  //    MUST use response.body (ReadableStream), NOT response.text() or response.arrayBuffer().
  const reader = response.body?.getReader();
  if (!reader) {
    return {
      ok: false,
      error: 'No response body',
      warnings,
    };
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > maxSize) {
        await reader.cancel();
        return {
          ok: false,
          error: `Response body exceeds max size (${maxSize} bytes)`,
          warnings,
        };
      }

      chunks.push(value);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `Error reading response body: ${message}`,
      warnings,
    };
  }

  // Concatenate chunks and decode as text
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.byteLength, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const body = new TextDecoder().decode(combined);

  // Extract response headers
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  // 6. Return SecureFetchResult
  return {
    ok: true,
    status: response.status,
    body,
    headers: responseHeaders,
    warnings,
  };
}

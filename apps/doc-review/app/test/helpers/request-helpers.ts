/**
 * HTTP request utilities for testing
 */

/**
 * Create a test request with common defaults
 */
export function createRequest(
  url: string,
  options: RequestInit = {}
): Request {
  const baseUrl = 'http://localhost:3000';
  const fullUrl = url.startsWith('http') ? url : `${baseUrl}${url}`;

  return new Request(fullUrl, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });
}

/**
 * Create a GET request
 */
export function createGetRequest(
  url: string,
  params?: Record<string, string>
): Request {
  let fullUrl = url;
  if (params) {
    const queryString = new URLSearchParams(params).toString();
    fullUrl = `${url}?${queryString}`;
  }

  return createRequest(fullUrl, { method: 'GET' });
}

/**
 * Create a POST request with JSON body
 */
export function createPostRequest(
  url: string,
  body: any
): Request {
  return createRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * Create a PATCH request with JSON body
 */
export function createPatchRequest(
  url: string,
  body: any
): Request {
  return createRequest(url, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/**
 * Create a PUT request with JSON body
 */
export function createPutRequest(
  url: string,
  body: any
): Request {
  return createRequest(url, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

/**
 * Create a DELETE request
 */
export function createDeleteRequest(url: string): Request {
  return createRequest(url, { method: 'DELETE' });
}

/**
 * Create a test context object (Remix/React Router context)
 */
export function createTestContext(overrides: any = {}): any {
  return {
    env: {},
    cloudflare: {
      env: {},
    },
    ...overrides,
  };
}

/**
 * Create a test params object
 */
export function createTestParams(params: Record<string, string> = {}): any {
  return params;
}

/**
 * Parse response JSON
 */
export async function parseResponse<T = any>(response: Response): Promise<T> {
  const text = await response.text();

  if (!text) {
    return {} as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(`Failed to parse response: ${text}`);
  }
}

/**
 * Assert response status
 */
export function assertResponseStatus(
  response: Response,
  expectedStatus: number
): void {
  if (response.status !== expectedStatus) {
    throw new Error(
      `Expected status ${expectedStatus}, got ${response.status}`
    );
  }
}

/**
 * Assert response is successful (2xx)
 */
export function assertResponseSuccess(response: Response): void {
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `Expected successful response, got status ${response.status}`
    );
  }
}

/**
 * Assert response is error (4xx or 5xx)
 */
export function assertResponseError(response: Response): void {
  if (response.status < 400) {
    throw new Error(
      `Expected error response, got status ${response.status}`
    );
  }
}

/**
 * Create pagination params
 */
export function createPaginationParams(
  limit: number = 50,
  offset: number = 0
): Record<string, string> {
  return {
    limit: limit.toString(),
    offset: offset.toString(),
  };
}

/**
 * Test response interface
 */
export interface TestResponse<T = any> {
  status: number;
  data: T;
  headers: Headers;
}

/**
 * Execute API call and return structured response
 */
export async function executeApiCall<T = any>(
  handler: (params: any) => Promise<Response>,
  params: {
    request: Request;
    context?: any;
    params?: any;
  }
): Promise<TestResponse<T>> {
  const response = await handler({
    request: params.request,
    context: params.context || createTestContext(),
    params: params.params || {},
  });

  const data = await parseResponse<T>(response);

  return {
    status: response.status,
    data,
    headers: response.headers,
  };
}

/**
 * Create multipart form data request
 */
export function createMultipartRequest(
  url: string,
  fields: Record<string, string | Blob>
): Request {
  const formData = new FormData();

  Object.entries(fields).forEach(([key, value]) => {
    formData.append(key, value);
  });

  return new Request(url, {
    method: 'POST',
    body: formData,
  });
}

/**
 * Create URL with query parameters
 */
export function createUrlWithParams(
  path: string,
  params: Record<string, string | number | boolean | null | undefined>
): string {
  const url = new URL(path, 'http://localhost:3000');

  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  });

  return url.toString();
}

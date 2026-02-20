/**
 * @tamma/mcp-client
 * JSON-RPC 2.0 utilities
 */

/**
 * JSON-RPC 2.0 Request
 */
export interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * JSON-RPC 2.0 Response
 */
export interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: JSONRPCError;
}

/**
 * JSON-RPC 2.0 Error
 */
export interface JSONRPCError {
  code: number;
  message: string;
  data?: unknown;
}

/**
 * JSON-RPC 2.0 Notification (no id, no response expected)
 */
export interface JSONRPCNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

/**
 * Standard JSON-RPC error codes
 */
export const JSONRPCErrorCodes = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  // Server errors: -32000 to -32099
  SERVER_ERROR_START: -32099,
  SERVER_ERROR_END: -32000,
} as const;

/**
 * Request ID generator
 */
export class RequestIdGenerator {
  private counter = 0;

  /**
   * Generate a unique request ID
   */
  next(): number {
    this.counter += 1;
    return this.counter;
  }

  /**
   * Reset the counter (useful for testing)
   */
  reset(): void {
    this.counter = 0;
  }
}

/**
 * Create a JSON-RPC request
 */
export function createRequest(
  id: number | string,
  method: string,
  params?: Record<string, unknown>
): JSONRPCRequest {
  const request: JSONRPCRequest = {
    jsonrpc: '2.0',
    id,
    method,
  };

  if (params !== undefined) {
    request.params = params;
  }

  return request;
}

/**
 * Create a JSON-RPC notification
 */
export function createNotification(
  method: string,
  params?: Record<string, unknown>
): JSONRPCNotification {
  const notification: JSONRPCNotification = {
    jsonrpc: '2.0',
    method,
  };

  if (params !== undefined) {
    notification.params = params;
  }

  return notification;
}

/**
 * Type guard for JSON-RPC request
 */
export function isJSONRPCRequest(value: unknown): value is JSONRPCRequest {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;
  return (
    obj['jsonrpc'] === '2.0' &&
    (typeof obj['id'] === 'number' || typeof obj['id'] === 'string') &&
    typeof obj['method'] === 'string'
  );
}

/**
 * Type guard for JSON-RPC response
 */
export function isJSONRPCResponse(value: unknown): value is JSONRPCResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;
  return (
    obj['jsonrpc'] === '2.0' &&
    (obj['id'] === null || typeof obj['id'] === 'number' || typeof obj['id'] === 'string') &&
    ('result' in obj || 'error' in obj)
  );
}

/**
 * Type guard for JSON-RPC notification
 */
export function isJSONRPCNotification(value: unknown): value is JSONRPCNotification {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;
  return (
    obj['jsonrpc'] === '2.0' &&
    typeof obj['method'] === 'string' &&
    !('id' in obj)
  );
}

/**
 * Type guard for JSON-RPC error
 */
export function isJSONRPCError(value: unknown): value is JSONRPCError {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;
  return typeof obj['code'] === 'number' && typeof obj['message'] === 'string';
}

/**
 * Check if a response is an error response
 */
export function isErrorResponse(response: JSONRPCResponse): boolean {
  return response.error !== undefined;
}

/**
 * Parse a JSON-RPC message from a string
 */
export function parseMessage(data: string): JSONRPCRequest | JSONRPCResponse | JSONRPCNotification {
  const parsed = JSON.parse(data) as unknown;

  if (isJSONRPCResponse(parsed)) {
    return parsed;
  }

  if (isJSONRPCRequest(parsed)) {
    return parsed;
  }

  if (isJSONRPCNotification(parsed)) {
    return parsed;
  }

  throw new Error('Invalid JSON-RPC message');
}

/**
 * Serialize a JSON-RPC message to a string
 */
export function serializeMessage(
  message: JSONRPCRequest | JSONRPCResponse | JSONRPCNotification
): string {
  return JSON.stringify(message);
}

/**
 * Create an error response
 */
export function createErrorResponse(
  id: number | string | null,
  code: number,
  message: string,
  data?: unknown
): JSONRPCResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      data,
    },
  };
}

/**
 * Create a success response
 */
export function createSuccessResponse(
  id: number | string,
  result: unknown
): JSONRPCResponse {
  return {
    jsonrpc: '2.0',
    id,
    result,
  };
}

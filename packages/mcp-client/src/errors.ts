/**
 * @tamma/mcp-client
 * MCP-specific error classes
 */

import { TammaError } from '@tamma/shared';

/**
 * Base MCP Error class
 */
export class MCPError extends TammaError {
  public readonly serverName?: string;

  constructor(
    message: string,
    code: string,
    options?: {
      serverName?: string;
      retryable?: boolean;
      context?: Record<string, unknown>;
      cause?: Error;
    }
  ) {
    super(message, code, {
      retryable: options?.retryable ?? false,
      context: { ...options?.context, serverName: options?.serverName },
      cause: options?.cause,
    });
    this.name = 'MCPError';
    this.serverName = options?.serverName;
  }
}

/**
 * MCP Connection Error
 */
export class MCPConnectionError extends MCPError {
  constructor(
    serverName: string,
    message: string,
    options?: { cause?: Error; retryable?: boolean }
  ) {
    super(message, 'MCP_CONNECTION_ERROR', {
      serverName,
      retryable: options?.retryable ?? true,
      cause: options?.cause,
    });
    this.name = 'MCPConnectionError';
  }
}

/**
 * MCP Timeout Error
 */
export class MCPTimeoutError extends MCPError {
  public readonly operation: string;
  public readonly timeoutMs: number;

  constructor(serverName: string, operation: string, timeoutMs: number) {
    super(
      `Operation '${operation}' timed out after ${timeoutMs}ms`,
      'MCP_TIMEOUT',
      {
        serverName,
        retryable: true,
        context: { operation, timeoutMs },
      }
    );
    this.name = 'MCPTimeoutError';
    this.operation = operation;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * MCP Tool Error
 */
export class MCPToolError extends MCPError {
  public readonly toolName: string;

  constructor(
    serverName: string,
    toolName: string,
    message: string,
    options?: { cause?: Error; retryable?: boolean }
  ) {
    super(
      `Tool '${toolName}' failed: ${message}`,
      'MCP_TOOL_ERROR',
      {
        serverName,
        retryable: options?.retryable ?? false,
        context: { toolName },
        cause: options?.cause,
      }
    );
    this.name = 'MCPToolError';
    this.toolName = toolName;
  }
}

/**
 * MCP Resource Error
 */
export class MCPResourceError extends MCPError {
  public readonly uri: string;

  constructor(
    serverName: string,
    uri: string,
    message: string,
    options?: { cause?: Error; retryable?: boolean }
  ) {
    super(
      `Resource '${uri}' error: ${message}`,
      'MCP_RESOURCE_ERROR',
      {
        serverName,
        retryable: options?.retryable ?? false,
        context: { uri },
        cause: options?.cause,
      }
    );
    this.name = 'MCPResourceError';
    this.uri = uri;
  }
}

/**
 * MCP Validation Error
 */
export class MCPValidationError extends MCPError {
  public readonly details?: Record<string, unknown>;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'MCP_VALIDATION_ERROR', {
      retryable: false,
      context: details,
    });
    this.name = 'MCPValidationError';
    this.details = details;
  }
}

/**
 * MCP Rate Limit Error
 */
export class MCPRateLimitError extends MCPError {
  public readonly retryAfterMs?: number;

  constructor(serverName: string, retryAfterMs?: number) {
    super(
      `Rate limit exceeded for server '${serverName}'`,
      'MCP_RATE_LIMIT',
      {
        serverName,
        retryable: true,
        context: { retryAfterMs },
      }
    );
    this.name = 'MCPRateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * MCP Protocol Error (for JSON-RPC errors)
 */
export class MCPProtocolError extends MCPError {
  public readonly jsonRpcCode: number;

  constructor(
    serverName: string,
    jsonRpcCode: number,
    message: string,
    options?: { cause?: Error; data?: unknown }
  ) {
    super(
      `Protocol error (code ${jsonRpcCode}): ${message}`,
      'MCP_PROTOCOL_ERROR',
      {
        serverName,
        retryable: false,
        context: { jsonRpcCode, data: options?.data },
        cause: options?.cause,
      }
    );
    this.name = 'MCPProtocolError';
    this.jsonRpcCode = jsonRpcCode;
  }
}

/**
 * MCP Server Not Found Error
 */
export class MCPServerNotFoundError extends MCPError {
  constructor(serverName: string) {
    super(
      `Server '${serverName}' not found`,
      'MCP_SERVER_NOT_FOUND',
      {
        serverName,
        retryable: false,
      }
    );
    this.name = 'MCPServerNotFoundError';
  }
}

/**
 * MCP Tool Not Found Error
 */
export class MCPToolNotFoundError extends MCPError {
  public readonly toolName: string;

  constructor(serverName: string, toolName: string) {
    super(
      `Tool '${toolName}' not found on server '${serverName}'`,
      'MCP_TOOL_NOT_FOUND',
      {
        serverName,
        retryable: false,
        context: { toolName },
      }
    );
    this.name = 'MCPToolNotFoundError';
    this.toolName = toolName;
  }
}

/**
 * MCP Resource Not Found Error
 */
export class MCPResourceNotFoundError extends MCPError {
  public readonly uri: string;

  constructor(serverName: string, uri: string) {
    super(
      `Resource '${uri}' not found on server '${serverName}'`,
      'MCP_RESOURCE_NOT_FOUND',
      {
        serverName,
        retryable: false,
        context: { uri },
      }
    );
    this.name = 'MCPResourceNotFoundError';
    this.uri = uri;
  }
}

/**
 * MCP Transport Error
 */
export class MCPTransportError extends MCPError {
  public readonly transportType: string;

  constructor(
    serverName: string,
    transportType: string,
    message: string,
    options?: { cause?: Error; retryable?: boolean }
  ) {
    super(
      `Transport (${transportType}) error: ${message}`,
      'MCP_TRANSPORT_ERROR',
      {
        serverName,
        retryable: options?.retryable ?? true,
        context: { transportType },
        cause: options?.cause,
      }
    );
    this.name = 'MCPTransportError';
    this.transportType = transportType;
  }
}

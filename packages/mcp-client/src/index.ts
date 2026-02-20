/**
 * @tamma/mcp-client
 * MCP (Model Context Protocol) client for connecting to MCP servers
 */

// Main client
export { MCPClient, createMCPClient, type MCPClientOptions } from './client.js';

// Types
export type {
  IMCPClient,
  MCPClientConfig,
  MCPServerConfig,
  ServerStatus,
  ServerInfo,
  ServerCapabilities,
  ServerMetrics,
  MCPTool,
  MCPResource,
  MCPPrompt,
  MCPPromptArgument,
  ResourceContent,
  ResourceReference,
  ToolResult,
  ToolResultContent,
  ToolInvocationOptions,
  ResourceReadOptions,
  HealthCheckResult,
  MCPClientEvent,
  EventHandler,
  Unsubscribe,
  ResourceCallback,
  JSONSchema,
} from './types.js';

export { DEFAULT_CLIENT_CONFIG, DEFAULT_SERVER_CONFIG } from './types.js';

// Errors
export {
  MCPError,
  MCPConnectionError,
  MCPTimeoutError,
  MCPToolError,
  MCPResourceError,
  MCPValidationError,
  MCPRateLimitError,
  MCPProtocolError,
  MCPServerNotFoundError,
  MCPToolNotFoundError,
  MCPResourceNotFoundError,
  MCPTransportError,
} from './errors.js';

// Registries
export {
  ToolRegistry,
  ResourceRegistry,
  PromptRegistry,
  type ToolFilterOptions,
  type ResourceFilterOptions,
  type PromptFilterOptions,
} from './registry.js';

// Transports
export {
  type IMCPTransport,
  type TransportMessage,
  type MessageHandler,
  type ErrorHandler,
  type CloseHandler,
  BaseTransport,
  type StdioTransportOptions,
  type SSETransportOptions,
  type WebSocketTransportOptions,
  StdioTransport,
  SSETransport,
  WebSocketTransport,
} from './transports/index.js';

// Connections
export {
  ServerConnection,
  ConnectionPool,
  type ConnectionPoolOptions,
  HealthChecker,
  type ServerHealthStatus,
  type HealthCheckOptions,
  pingServer,
  isOperational,
  isTransitional,
  isUnhealthy,
} from './connections/index.js';

// Cache
export {
  CapabilityCache,
  type CachedCapabilities,
  type CapabilityCacheOptions,
  ResourceCache,
  type CachedResource,
  type ResourceCacheOptions,
} from './cache/index.js';

// Security
export {
  RateLimiter,
  RateLimiterRegistry,
  type RateLimiterOptions,
  validateClientConfig,
  validateServerConfig,
  validateStdioCommand,
  validateTransportUrl,
  sanitizeEnv,
  validateServerNames,
  OutputCollector,
  ResourceMonitor,
  PathValidator,
  createSandboxEnv,
  type SandboxOptions,
  DEFAULT_SANDBOX_OPTIONS,
} from './security/index.js';

// Utilities
export {
  // JSON-RPC
  type JSONRPCRequest,
  type JSONRPCResponse,
  type JSONRPCError,
  type JSONRPCNotification,
  JSONRPCErrorCodes,
  RequestIdGenerator,
  createRequest,
  createNotification,
  isJSONRPCRequest,
  isJSONRPCResponse,
  isJSONRPCNotification,
  isJSONRPCError,
  isErrorResponse,
  parseMessage,
  serializeMessage,
  createErrorResponse,
  createSuccessResponse,
  // Retry
  withRetry,
  retryable,
  calculateDelay,
  sleep,
  CircuitBreaker,
  type RetryOptions,
  type RetryContext,
  type CircuitBreakerOptions,
  type CircuitState,
  DEFAULT_RETRY_OPTIONS,
  DEFAULT_CIRCUIT_BREAKER_OPTIONS,
  // Schema validation
  validateSchema,
  validateToolArguments,
  applyDefaults,
  type ValidationResult,
  type ValidationError,
} from './utils/index.js';

// Streaming
export {
  type StreamHandler,
  type StreamChunk,
  type StreamingToolResult,
  StreamingResultCollector,
  createNonStreamingResult,
} from './streaming.js';

// Audit logging
export {
  type AuditEventType,
  type AuditEntry,
  type AuditOutputHandler,
  type AuditLoggerOptions,
  type AuditStats,
  AuditLogger,
  createConsoleAuditHandler,
  createJsonLinesAuditHandler,
} from './audit.js';

// Pagination
export {
  type PaginationOptions,
  type PaginatedResult,
  type PaginatedResourceList,
  type PaginatedResourceContent,
  DEFAULT_PAGE_SIZE,
  paginateArray,
  ResourcePaginator,
  PaginatedIterator,
  offsetToCursor,
  cursorToOffset,
} from './pagination.js';

// Built-in server helpers
export {
  type GitHubServerOptions,
  type FilesystemServerOptions,
  type PostgresServerOptions,
  type SlackServerOptions,
  type CustomStdioServerOptions,
  type CustomSSEServerOptions,
  createGitHubServer,
  createFilesystemServer,
  createPostgresServer,
  createSlackServer,
  createCustomStdioServer,
  createCustomSSEServer,
  validateServerConfig as validateServerConfigHelper,
  SERVER_PRESETS,
} from './servers/index.js';

/**
 * @tamma/mcp-client
 * Type definitions for MCP (Model Context Protocol) client
 */

/**
 * MCP Client configuration
 */
export interface MCPClientConfig {
  servers: MCPServerConfig[];
  defaultTimeout: number;        // Default: 30000ms
  retryAttempts: number;         // Default: 3
  retryDelayMs: number;          // Default: 1000ms
  enableCaching: boolean;        // Default: true
  cacheTTLMs: number;            // Default: 300000ms (5 min)
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * MCP Server configuration
 */
export interface MCPServerConfig {
  name: string;
  transport: 'stdio' | 'sse' | 'websocket';

  // Stdio transport options
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;

  // SSE/WebSocket transport options
  url?: string;
  headers?: Record<string, string>;

  // Common options
  timeout?: number;
  enabled?: boolean;
  autoConnect?: boolean;        // Default: true
  reconnectOnError?: boolean;   // Default: true
  maxReconnectAttempts?: number; // Default: 5

  // Rate limiting
  rateLimitRpm?: number;        // Requests per minute

  // Security
  sandboxed?: boolean;          // Default: true for stdio
}

/**
 * Server connection status
 */
export type ServerStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

/**
 * Server information
 */
export interface ServerInfo {
  name: string;
  transport: 'stdio' | 'sse' | 'websocket';
  status: ServerStatus;
  capabilities: ServerCapabilities;
  toolCount: number;
  resourceCount: number;
  promptCount: number;
  lastConnected?: Date;
  lastError?: Error;
  metrics: ServerMetrics;
}

/**
 * Server capabilities as returned by initialize
 */
export interface ServerCapabilities {
  tools?: { listChanged?: boolean };
  resources?: { subscribe?: boolean; listChanged?: boolean };
  prompts?: { listChanged?: boolean };
  logging?: Record<string, unknown>;
  experimental?: Record<string, unknown>;
}

/**
 * Server metrics
 */
export interface ServerMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageLatencyMs: number;
  lastRequestTime?: Date;
}

/**
 * MCP Tool definition
 */
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  serverName: string;
}

/**
 * Tool invocation result
 */
export interface ToolResult {
  success: boolean;
  content: ToolResultContent[];
  error?: string;
  isStreaming?: boolean;
  metadata?: {
    latencyMs: number;
    serverName: string;
    toolName: string;
  };
}

export type ToolResultContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'resource'; resource: ResourceReference };

/**
 * MCP Resource definition
 */
export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  serverName: string;
}

/**
 * MCP Prompt definition
 */
export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: MCPPromptArgument[];
  serverName: string;
}

/**
 * MCP Prompt argument
 */
export interface MCPPromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

/**
 * Resource content
 */
export interface ResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: Uint8Array;
}

/**
 * Resource reference (for tool results)
 */
export interface ResourceReference {
  uri: string;
  mimeType?: string;
  text?: string;
}

/**
 * JSON Schema type for tool input schemas
 */
export interface JSONSchema {
  type?: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  enum?: unknown[];
  description?: string;
  default?: unknown;
  [key: string]: unknown;
}

/**
 * Resource subscription callback
 */
export type ResourceCallback = (content: ResourceContent) => void | Promise<void>;

/**
 * Unsubscribe function
 */
export type Unsubscribe = () => void;

/**
 * MCP Client event types
 */
export type MCPClientEvent =
  | 'server:connected'
  | 'server:disconnected'
  | 'server:error'
  | 'server:reconnecting'
  | 'tool:invoked'
  | 'tool:completed'
  | 'resource:updated';

/**
 * Event handler type
 */
export type EventHandler<T = unknown> = (data: T) => void | Promise<void>;

/**
 * Tool invocation options
 */
export interface ToolInvocationOptions {
  timeout?: number;
  signal?: AbortSignal;
  stream?: boolean;
}

/**
 * Resource read options
 */
export interface ResourceReadOptions {
  timeout?: number;
  useCache?: boolean;
  signal?: AbortSignal;
}

/**
 * Health check result
 */
export interface HealthCheckResult {
  healthy: boolean;
  servers: Record<string, {
    status: ServerStatus;
    latencyMs?: number;
    error?: string;
  }>;
}

/**
 * MCP Client Interface
 */
export interface IMCPClient {
  // Lifecycle
  initialize(config: MCPClientConfig): Promise<void>;
  dispose(): Promise<void>;

  // Server management
  connectServer(name: string): Promise<void>;
  disconnectServer(name: string): Promise<void>;
  getServerStatus(name: string): ServerStatus;
  getServerInfo(name: string): ServerInfo | undefined;
  listServers(): ServerInfo[];

  // Tool operations
  listTools(serverName?: string): MCPTool[];
  getToolSchema(serverName: string, toolName: string): JSONSchema | undefined;
  invokeTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
    options?: ToolInvocationOptions
  ): Promise<ToolResult>;

  // Resource operations
  listResources(serverName?: string): MCPResource[];
  readResource(
    serverName: string,
    uri: string,
    options?: ResourceReadOptions
  ): Promise<ResourceContent>;
  subscribeResource(
    serverName: string,
    uri: string,
    callback: ResourceCallback
  ): Unsubscribe;

  // Events
  on<T = unknown>(event: MCPClientEvent, handler: EventHandler<T>): Unsubscribe;

  // Health check
  healthCheck(): Promise<HealthCheckResult>;
}

/**
 * Default client configuration
 */
export const DEFAULT_CLIENT_CONFIG: Omit<MCPClientConfig, 'servers'> = {
  defaultTimeout: 30000,
  retryAttempts: 3,
  retryDelayMs: 1000,
  enableCaching: true,
  cacheTTLMs: 300000, // 5 minutes
  logLevel: 'info',
};

/**
 * Default server configuration values
 */
export const DEFAULT_SERVER_CONFIG = {
  enabled: true,
  autoConnect: true,
  reconnectOnError: true,
  maxReconnectAttempts: 5,
  sandboxed: true,
} as const;

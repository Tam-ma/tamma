/**
 * MCP Server Types
 *
 * Types for MCP (Model Context Protocol) server management.
 */

/** MCP server information and status */
export interface MCPServerInfo {
  name: string;
  status: 'connected' | 'disconnected' | 'error' | 'starting';
  transport: 'stdio' | 'sse';
  toolCount: number;
  resourceCount: number;
  lastConnected?: string;
  error?: string;
  config: MCPServerConfig;
}

/** MCP server configuration */
export interface MCPServerConfig {
  name: string;
  transport: 'stdio' | 'sse';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  timeout?: number;
  enabled: boolean;
}

/** MCP tool definition */
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  serverName: string;
}

/** MCP resource definition */
export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  serverName: string;
}

/** Request to invoke an MCP tool */
export interface MCPToolInvokeRequest {
  serverName: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

/** Result of an MCP tool invocation */
export interface MCPToolInvokeResult {
  success: boolean;
  content: unknown;
  error?: string;
  durationMs: number;
}

/** MCP server log entry */
export interface MCPServerLog {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  data?: Record<string, unknown>;
}

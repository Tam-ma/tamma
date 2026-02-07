/**
 * @tamma/mcp-client
 * Built-in server configuration helpers
 *
 * Pre-configured settings for common MCP servers to make setup easier.
 */

import type { MCPServerConfig } from '../types.js';

/**
 * GitHub MCP server configuration
 */
export interface GitHubServerOptions {
  /** Server name (default: 'github') */
  name?: string;
  /** GitHub personal access token (required) */
  githubToken: string;
  /** Enable the server (default: true) */
  enabled?: boolean;
  /** Timeout in ms (default: 60000) */
  timeout?: number;
  /** Rate limit requests per minute (default: 100) */
  rateLimitRpm?: number;
}

/**
 * Create GitHub MCP server configuration
 *
 * @example
 * ```typescript
 * const config = createGitHubServer({
 *   githubToken: process.env.GITHUB_TOKEN!,
 * });
 * ```
 */
export function createGitHubServer(options: GitHubServerOptions): MCPServerConfig {
  return {
    name: options.name ?? 'github',
    transport: 'stdio',
    command: 'npx',
    args: ['@modelcontextprotocol/server-github'],
    env: {
      GITHUB_TOKEN: options.githubToken,
    },
    enabled: options.enabled ?? true,
    timeout: options.timeout ?? 60000,
    rateLimitRpm: options.rateLimitRpm ?? 100,
    reconnectOnError: true,
    maxReconnectAttempts: 3,
  };
}

/**
 * Filesystem MCP server configuration
 */
export interface FilesystemServerOptions {
  /** Server name (default: 'filesystem') */
  name?: string;
  /** Allowed paths for file access (required) */
  allowedPaths: string[];
  /** Enable the server (default: true) */
  enabled?: boolean;
  /** Timeout in ms (default: 30000) */
  timeout?: number;
  /** Rate limit requests per minute (default: 1000) */
  rateLimitRpm?: number;
}

/**
 * Create Filesystem MCP server configuration
 *
 * @example
 * ```typescript
 * const config = createFilesystemServer({
 *   allowedPaths: ['/workspace', '/home/user/projects'],
 * });
 * ```
 */
export function createFilesystemServer(
  options: FilesystemServerOptions
): MCPServerConfig {
  return {
    name: options.name ?? 'filesystem',
    transport: 'stdio',
    command: 'npx',
    args: ['@modelcontextprotocol/server-filesystem', ...options.allowedPaths],
    enabled: options.enabled ?? true,
    timeout: options.timeout ?? 30000,
    rateLimitRpm: options.rateLimitRpm ?? 1000,
    sandboxed: true,
    reconnectOnError: true,
    maxReconnectAttempts: 5,
  };
}

/**
 * PostgreSQL MCP server configuration
 */
export interface PostgresServerOptions {
  /** Server name (default: 'postgres') */
  name?: string;
  /** Database connection URL (required) */
  databaseUrl: string;
  /** Enable the server (default: true) */
  enabled?: boolean;
  /** Timeout in ms (default: 120000 for long queries) */
  timeout?: number;
  /** Rate limit requests per minute (default: 60) */
  rateLimitRpm?: number;
}

/**
 * Create PostgreSQL MCP server configuration
 *
 * @example
 * ```typescript
 * const config = createPostgresServer({
 *   databaseUrl: process.env.DATABASE_URL!,
 * });
 * ```
 */
export function createPostgresServer(
  options: PostgresServerOptions
): MCPServerConfig {
  return {
    name: options.name ?? 'postgres',
    transport: 'stdio',
    command: 'npx',
    args: ['@modelcontextprotocol/server-postgres'],
    env: {
      DATABASE_URL: options.databaseUrl,
    },
    enabled: options.enabled ?? true,
    timeout: options.timeout ?? 120000,
    rateLimitRpm: options.rateLimitRpm ?? 60,
    reconnectOnError: true,
    maxReconnectAttempts: 3,
  };
}

/**
 * Slack MCP server configuration
 */
export interface SlackServerOptions {
  /** Server name (default: 'slack') */
  name?: string;
  /** Slack OAuth token (required) */
  slackToken: string;
  /** Server URL for SSE transport (required) */
  url: string;
  /** Enable the server (default: true) */
  enabled?: boolean;
  /** Timeout in ms (default: 30000) */
  timeout?: number;
  /** Rate limit requests per minute (default: 50) */
  rateLimitRpm?: number;
}

/**
 * Create Slack MCP server configuration
 *
 * @example
 * ```typescript
 * const config = createSlackServer({
 *   slackToken: process.env.SLACK_TOKEN!,
 *   url: 'http://localhost:3001/mcp',
 * });
 * ```
 */
export function createSlackServer(options: SlackServerOptions): MCPServerConfig {
  return {
    name: options.name ?? 'slack',
    transport: 'sse',
    url: options.url,
    headers: {
      Authorization: `Bearer ${options.slackToken}`,
    },
    enabled: options.enabled ?? true,
    timeout: options.timeout ?? 30000,
    rateLimitRpm: options.rateLimitRpm ?? 50,
    reconnectOnError: true,
    maxReconnectAttempts: 5,
  };
}

/**
 * Custom stdio server configuration
 */
export interface CustomStdioServerOptions {
  /** Server name (required) */
  name: string;
  /** Command to execute (required) */
  command: string;
  /** Command arguments */
  args?: string[];
  /** Environment variables */
  env?: Record<string, string>;
  /** Working directory */
  cwd?: string;
  /** Enable the server (default: true) */
  enabled?: boolean;
  /** Timeout in ms (default: 30000) */
  timeout?: number;
  /** Rate limit requests per minute */
  rateLimitRpm?: number;
  /** Enable sandboxing (default: true) */
  sandboxed?: boolean;
}

/**
 * Create custom stdio server configuration
 *
 * @example
 * ```typescript
 * const config = createCustomStdioServer({
 *   name: 'my-server',
 *   command: 'python',
 *   args: ['./my_mcp_server.py'],
 *   env: { MY_API_KEY: process.env.MY_API_KEY! },
 * });
 * ```
 */
export function createCustomStdioServer(
  options: CustomStdioServerOptions
): MCPServerConfig {
  return {
    name: options.name,
    transport: 'stdio',
    command: options.command,
    args: options.args,
    env: options.env,
    cwd: options.cwd,
    enabled: options.enabled ?? true,
    timeout: options.timeout ?? 30000,
    rateLimitRpm: options.rateLimitRpm,
    sandboxed: options.sandboxed ?? true,
    reconnectOnError: true,
    maxReconnectAttempts: 5,
  };
}

/**
 * Custom SSE server configuration
 */
export interface CustomSSEServerOptions {
  /** Server name (required) */
  name: string;
  /** Server URL (required) */
  url: string;
  /** Request headers */
  headers?: Record<string, string>;
  /** Enable the server (default: true) */
  enabled?: boolean;
  /** Timeout in ms (default: 30000) */
  timeout?: number;
  /** Rate limit requests per minute */
  rateLimitRpm?: number;
}

/**
 * Create custom SSE server configuration
 *
 * @example
 * ```typescript
 * const config = createCustomSSEServer({
 *   name: 'my-sse-server',
 *   url: 'https://my-server.example.com/mcp',
 *   headers: { 'X-API-Key': process.env.API_KEY! },
 * });
 * ```
 */
export function createCustomSSEServer(
  options: CustomSSEServerOptions
): MCPServerConfig {
  return {
    name: options.name,
    transport: 'sse',
    url: options.url,
    headers: options.headers,
    enabled: options.enabled ?? true,
    timeout: options.timeout ?? 30000,
    rateLimitRpm: options.rateLimitRpm,
    reconnectOnError: true,
    maxReconnectAttempts: 5,
  };
}

/**
 * Validate server configuration has required fields
 */
export function validateServerConfig(config: MCPServerConfig): string[] {
  const errors: string[] = [];

  if (!config.name) {
    errors.push('Server name is required');
  }

  if (!config.transport) {
    errors.push('Transport type is required');
  }

  if (config.transport === 'stdio' && !config.command) {
    errors.push('Command is required for stdio transport');
  }

  if ((config.transport === 'sse' || config.transport === 'websocket') && !config.url) {
    errors.push('URL is required for SSE/WebSocket transport');
  }

  return errors;
}

/**
 * Server configuration presets
 */
export const SERVER_PRESETS = {
  github: createGitHubServer,
  filesystem: createFilesystemServer,
  postgres: createPostgresServer,
  slack: createSlackServer,
  customStdio: createCustomStdioServer,
  customSSE: createCustomSSEServer,
} as const;

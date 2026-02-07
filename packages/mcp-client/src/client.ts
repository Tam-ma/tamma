/**
 * @tamma/mcp-client
 * Main MCP Client implementation
 */

import EventEmitter from 'eventemitter3';
import type {
  IMCPClient,
  MCPClientConfig,
  MCPServerConfig,
  ServerStatus,
  ServerInfo,
  MCPTool,
  MCPResource,
  ResourceContent,
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
import { DEFAULT_SERVER_CONFIG } from './types.js';
import { ConnectionPool } from './connections/pool.js';
import { HealthChecker } from './connections/health.js';
import { ToolRegistry, ResourceRegistry, PromptRegistry } from './registry.js';
import { CapabilityCache } from './cache/capability-cache.js';
import { ResourceCache } from './cache/resource-cache.js';
import { RateLimiterRegistry } from './security/rate-limiter.js';
import {
  validateClientConfig,
  validateServerNames,
  validateStdioCommand,
  validateTransportUrl,
} from './security/validator.js';
import { validateToolArguments, applyDefaults } from './utils/schema-validator.js';
import { withRetry } from './utils/retry.js';
import {
  MCPError,
  MCPServerNotFoundError,
  MCPToolNotFoundError,
  MCPToolError,
  MCPResourceError,
  MCPResourceNotFoundError,
  MCPRateLimitError,
} from './errors.js';
import { AuditLogger, type AuditLoggerOptions } from './audit.js';
import { type StreamingToolResult, createNonStreamingResult } from './streaming.js';
import { paginateArray, type PaginationOptions, type PaginatedResult } from './pagination.js';

/**
 * MCP Client implementation
 *
 * Manages connections to multiple MCP servers and provides a unified
 * interface for tool invocation and resource access.
 */
/**
 * MCP Client options
 */
export interface MCPClientOptions {
  /** Enable audit logging (default: true) */
  enableAuditLog?: boolean;
  /** Audit logger options */
  auditLogOptions?: AuditLoggerOptions;
}

export class MCPClient implements IMCPClient {
  private config?: MCPClientConfig;
  private readonly connectionPool: ConnectionPool;
  private readonly healthChecker: HealthChecker;
  private readonly toolRegistry: ToolRegistry;
  private readonly resourceRegistry: ResourceRegistry;
  private readonly promptRegistry: PromptRegistry;
  private readonly capabilityCache: CapabilityCache;
  private readonly resourceCache: ResourceCache;
  private readonly rateLimiters: RateLimiterRegistry;
  private readonly eventEmitter: EventEmitter;
  private readonly auditLogger?: AuditLogger;
  private initialized = false;

  // Resource subscriptions
  private readonly subscriptions = new Map<string, Set<ResourceCallback>>();

  constructor(options?: MCPClientOptions) {
    this.connectionPool = new ConnectionPool();
    this.healthChecker = new HealthChecker();
    this.toolRegistry = new ToolRegistry();
    this.resourceRegistry = new ResourceRegistry();
    this.promptRegistry = new PromptRegistry();
    this.capabilityCache = new CapabilityCache();
    this.resourceCache = new ResourceCache();
    this.rateLimiters = new RateLimiterRegistry();
    this.eventEmitter = new EventEmitter();

    // Initialize audit logger if enabled
    if (options?.enableAuditLog !== false) {
      this.auditLogger = new AuditLogger(options?.auditLogOptions);
    }

    // Set up connection pool event handling
    this.connectionPool.setOnServerStatusChange((serverName, status) => {
      this.handleServerStatusChange(serverName, status);
    });
  }

  /**
   * Initialize the MCP client with configuration
   */
  async initialize(config: MCPClientConfig): Promise<void> {
    if (this.initialized) {
      throw new MCPError('Client already initialized', 'MCP_ALREADY_INITIALIZED');
    }

    // Validate configuration
    this.config = validateClientConfig(config);
    validateServerNames(this.config.servers);

    // Validate each server config
    for (const serverConfig of this.config.servers) {
      this.validateServerConfig(serverConfig);
    }

    // Set up capability cache with configured TTL
    if (this.config.enableCaching) {
      // Cache is already initialized with default TTL
    }

    // Add servers to pool
    for (const serverConfig of this.config.servers) {
      if (serverConfig.enabled !== false) {
        this.connectionPool.addServer({
          ...DEFAULT_SERVER_CONFIG,
          ...serverConfig,
        });

        // Set up rate limiter if configured
        if (serverConfig.rateLimitRpm) {
          this.rateLimiters.getOrCreate(serverConfig.name, serverConfig.rateLimitRpm);
        }
      }
    }

    // Auto-connect servers
    const autoConnectServers = this.config.servers.filter(
      (s) => s.enabled !== false && s.autoConnect !== false
    );

    if (autoConnectServers.length > 0) {
      const results = await this.connectionPool.connectAll();

      // Process connection results
      for (const [serverName, error] of results) {
        if (error) {
          this.eventEmitter.emit('server:error', { serverName, error });
        } else {
          await this.syncServerCapabilities(serverName);
          this.eventEmitter.emit('server:connected', { serverName });
        }
      }
    }

    this.initialized = true;
  }

  /**
   * Dispose the client and clean up resources
   */
  async dispose(): Promise<void> {
    // Clear subscriptions
    this.subscriptions.clear();

    // Disconnect all servers
    await this.connectionPool.disconnectAll();
    await this.connectionPool.clear();

    // Clear registries
    this.toolRegistry.clear();
    this.resourceRegistry.clear();
    this.promptRegistry.clear();

    // Clear caches
    this.capabilityCache.invalidateAll();
    this.resourceCache.clear();

    // Clear rate limiters
    this.rateLimiters.clear();

    // Clear event listeners
    this.eventEmitter.removeAllListeners();

    this.initialized = false;
    this.config = undefined;
  }

  /**
   * Connect to a specific server
   */
  async connectServer(name: string): Promise<void> {
    this.ensureInitialized();

    try {
      await this.connectionPool.connect(name);
      await this.syncServerCapabilities(name);
      this.eventEmitter.emit('server:connected', { serverName: name });
      this.auditLogger?.logServerConnect(name, true);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.auditLogger?.logServerConnect(name, false, errorMessage);
      throw error;
    }
  }

  /**
   * Disconnect from a specific server
   */
  async disconnectServer(name: string): Promise<void> {
    this.ensureInitialized();

    await this.connectionPool.disconnect(name);

    // Clear server data from registries
    this.toolRegistry.unregisterServer(name);
    this.resourceRegistry.unregisterServer(name);
    this.promptRegistry.unregisterServer(name);
    this.capabilityCache.invalidate(name);
    this.resourceCache.clearServer(name);

    this.eventEmitter.emit('server:disconnected', { serverName: name });
    this.auditLogger?.logServerDisconnect(name);
  }

  /**
   * Get server status
   */
  getServerStatus(name: string): ServerStatus {
    this.ensureInitialized();
    return this.connectionPool.getStatus(name);
  }

  /**
   * Get server info
   */
  getServerInfo(name: string): ServerInfo | undefined {
    this.ensureInitialized();
    return this.connectionPool.getServerInfo(name);
  }

  /**
   * List all servers
   */
  listServers(): ServerInfo[] {
    this.ensureInitialized();
    return this.connectionPool.getServerInfos();
  }

  /**
   * List tools, optionally filtered by server
   */
  listTools(serverName?: string): MCPTool[] {
    this.ensureInitialized();
    if (serverName) {
      return this.toolRegistry.listByServer(serverName);
    }
    return this.toolRegistry.list();
  }

  /**
   * Get tool schema
   */
  getToolSchema(serverName: string, toolName: string): JSONSchema | undefined {
    this.ensureInitialized();
    return this.toolRegistry.getSchema(serverName, toolName);
  }

  /**
   * Invoke a tool on a server
   */
  async invokeTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
    options?: ToolInvocationOptions
  ): Promise<ToolResult> {
    this.ensureInitialized();

    const startTime = Date.now();

    // Get connection
    const connection = this.connectionPool.requireConnection(serverName);

    if (connection.getStatus() !== 'connected') {
      throw new MCPServerNotFoundError(serverName);
    }

    // Check tool exists
    const tool = this.toolRegistry.get(serverName, toolName);
    if (!tool) {
      throw new MCPToolNotFoundError(serverName, toolName);
    }

    // Validate arguments
    const argsWithDefaults = applyDefaults(args, tool.inputSchema);
    validateToolArguments(argsWithDefaults, tool.inputSchema, toolName);

    // Check rate limit
    const rateLimiter = this.rateLimiters.get(serverName);
    if (rateLimiter && !rateLimiter.tryAcquire()) {
      throw new MCPRateLimitError(serverName, rateLimiter.getTimeUntilNextToken());
    }

    this.eventEmitter.emit('tool:invoked', { serverName, toolName, args: argsWithDefaults });

    // Audit log the invocation
    const auditId = this.auditLogger?.logToolInvoke(serverName, toolName, argsWithDefaults);

    try {
      // Execute with retry
      const result = await withRetry(
        async () => {
          return connection.invokeTool(toolName, argsWithDefaults, options?.timeout);
        },
        {
          maxAttempts: this.config?.retryAttempts ?? 3,
          initialDelayMs: this.config?.retryDelayMs ?? 1000,
          signal: options?.signal,
          isRetryable: (error) => {
            // Don't retry validation errors
            if (error.message.includes('Invalid arguments')) {
              return false;
            }
            return true;
          },
        }
      );

      const latencyMs = Date.now() - startTime;

      // Transform result to ToolResult
      const toolResult: ToolResult = {
        success: !result.isError,
        content: result.content.map((c) => this.transformContent(c)),
        error: result.isError ? result.content.map((c) => c.text).join('\n') : undefined,
        metadata: {
          latencyMs,
          serverName,
          toolName,
        },
      };

      this.eventEmitter.emit('tool:completed', {
        serverName,
        toolName,
        success: toolResult.success,
        latencyMs,
      });

      // Audit log the completion
      if (auditId) {
        this.auditLogger?.logToolComplete(
          auditId,
          serverName,
          toolName,
          toolResult.success,
          latencyMs,
          toolResult.error
        );
      }

      return toolResult;
    } catch (error) {
      const latencyMs = Date.now() - startTime;

      this.eventEmitter.emit('tool:completed', {
        serverName,
        toolName,
        success: false,
        latencyMs,
        error,
      });

      // Audit log the failure
      if (auditId) {
        this.auditLogger?.logToolComplete(
          auditId,
          serverName,
          toolName,
          false,
          latencyMs,
          error instanceof Error ? error.message : String(error)
        );
      }

      if (error instanceof MCPError) {
        throw error;
      }

      throw new MCPToolError(
        serverName,
        toolName,
        error instanceof Error ? error.message : String(error),
        { cause: error instanceof Error ? error : undefined }
      );
    }
  }

  /**
   * List resources, optionally filtered by server
   */
  listResources(serverName?: string): MCPResource[] {
    this.ensureInitialized();
    if (serverName) {
      return this.resourceRegistry.listByServer(serverName);
    }
    return this.resourceRegistry.list();
  }

  /**
   * Read a resource
   */
  async readResource(
    serverName: string,
    uri: string,
    options?: ResourceReadOptions
  ): Promise<ResourceContent> {
    this.ensureInitialized();

    // Check cache first
    if (options?.useCache !== false && this.config?.enableCaching) {
      const cached = this.resourceCache.get(serverName, uri);
      if (cached) {
        return cached;
      }
    }

    // Get connection
    const connection = this.connectionPool.requireConnection(serverName);

    if (connection.getStatus() !== 'connected') {
      throw new MCPServerNotFoundError(serverName);
    }

    // Check resource exists
    if (!this.resourceRegistry.has(serverName, uri)) {
      throw new MCPResourceNotFoundError(serverName, uri);
    }

    // Check rate limit
    const rateLimiter = this.rateLimiters.get(serverName);
    if (rateLimiter && !rateLimiter.tryAcquire()) {
      throw new MCPRateLimitError(serverName, rateLimiter.getTimeUntilNextToken());
    }

    const startTime = Date.now();

    try {
      const result = await connection.readResource(uri, options?.timeout);

      if (!result.contents || result.contents.length === 0) {
        throw new MCPResourceError(serverName, uri, 'No content returned');
      }

      const content = result.contents[0];
      if (!content) {
        throw new MCPResourceError(serverName, uri, 'Empty content');
      }

      const resourceContent: ResourceContent = {
        uri: content.uri,
        mimeType: content.mimeType,
        text: content.text,
        blob: content.blob ? this.base64ToUint8Array(content.blob) : undefined,
      };

      // Cache result
      if (this.config?.enableCaching) {
        this.resourceCache.set(serverName, resourceContent);
      }

      // Audit log the read
      this.auditLogger?.logResourceRead(
        serverName,
        uri,
        true,
        Date.now() - startTime
      );

      return resourceContent;
    } catch (error) {
      // Audit log the failure
      this.auditLogger?.logResourceRead(
        serverName,
        uri,
        false,
        Date.now() - startTime,
        error instanceof Error ? error.message : String(error)
      );

      if (error instanceof MCPError) {
        throw error;
      }

      throw new MCPResourceError(
        serverName,
        uri,
        error instanceof Error ? error.message : String(error),
        { cause: error instanceof Error ? error : undefined }
      );
    }
  }

  /**
   * Subscribe to resource updates
   */
  subscribeResource(
    serverName: string,
    uri: string,
    callback: ResourceCallback
  ): Unsubscribe {
    this.ensureInitialized();
    const key = `${serverName}:${uri}`;

    let callbacks = this.subscriptions.get(key);
    if (!callbacks) {
      callbacks = new Set();
      this.subscriptions.set(key, callbacks);
    }

    callbacks.add(callback);

    // Return unsubscribe function
    return () => {
      const cbs = this.subscriptions.get(key);
      if (cbs) {
        cbs.delete(callback);
        if (cbs.size === 0) {
          this.subscriptions.delete(key);
        }
      }
    };
  }

  /**
   * Register an event handler
   */
  on<T = unknown>(event: MCPClientEvent, handler: EventHandler<T>): Unsubscribe {
    this.ensureInitialized();
    this.eventEmitter.on(event, handler as (...args: unknown[]) => void);

    return () => {
      this.eventEmitter.off(event, handler as (...args: unknown[]) => void);
    };
  }

  /**
   * Perform health check on all servers
   */
  async healthCheck(): Promise<HealthCheckResult> {
    const servers = this.listServers();
    return this.healthChecker.buildHealthCheckResult(servers);
  }

  /**
   * Invoke a tool with streaming support
   * Returns a streaming result that can be iterated or collected
   */
  async invokeToolStreaming(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
    options?: ToolInvocationOptions
  ): Promise<StreamingToolResult> {
    // For now, use non-streaming invocation and wrap in streaming interface
    // Full streaming support would require protocol-level streaming
    const result = await this.invokeTool(serverName, toolName, args, options);

    return createNonStreamingResult(result.content);
  }

  /**
   * List resources with pagination support
   */
  listResourcesPaginated(
    serverName?: string,
    options?: PaginationOptions
  ): PaginatedResult<MCPResource> {
    this.ensureInitialized();

    const resources = serverName
      ? this.resourceRegistry.listByServer(serverName)
      : this.resourceRegistry.list();

    return paginateArray(resources, options);
  }

  /**
   * List tools with pagination support
   */
  listToolsPaginated(
    serverName?: string,
    options?: PaginationOptions
  ): PaginatedResult<MCPTool> {
    this.ensureInitialized();

    const tools = serverName
      ? this.toolRegistry.listByServer(serverName)
      : this.toolRegistry.list();

    return paginateArray(tools, options);
  }

  /**
   * Get the audit logger instance
   */
  getAuditLogger(): AuditLogger | undefined {
    return this.auditLogger;
  }

  /**
   * Validate server configuration
   */
  private validateServerConfig(config: MCPServerConfig): void {
    if (config.transport === 'stdio' && config.command) {
      validateStdioCommand(config.command);
    }

    if ((config.transport === 'sse' || config.transport === 'websocket') && config.url) {
      validateTransportUrl(config.url);
    }
  }

  /**
   * Sync server capabilities to registries
   */
  private async syncServerCapabilities(serverName: string): Promise<void> {
    const connection = this.connectionPool.getConnection(serverName);
    if (!connection) {
      return;
    }

    // Register tools
    const tools = connection.getTools();
    this.toolRegistry.registerAll(tools);

    // Register resources
    const resources = connection.getResources();
    this.resourceRegistry.registerAll(resources);

    // Register prompts
    const prompts = connection.getPrompts();
    this.promptRegistry.registerAll(prompts);

    // Update capability cache
    this.capabilityCache.set(serverName, {
      capabilities: connection.getCapabilities(),
      tools,
      resources,
      prompts,
      cachedAt: Date.now(),
    });

    // Set up change handlers
    connection.setOnToolsChanged((newTools) => {
      this.toolRegistry.unregisterServer(serverName);
      this.toolRegistry.registerAll(newTools);
    });

    connection.setOnResourcesChanged((newResources) => {
      this.resourceRegistry.unregisterServer(serverName);
      this.resourceRegistry.registerAll(newResources);
    });
  }

  /**
   * Handle server status change
   */
  private handleServerStatusChange(serverName: string, status: ServerStatus): void {
    // Record health check
    this.healthChecker.recordCheck(serverName, {
      status,
      lastChecked: new Date(),
    });

    // Emit appropriate event
    switch (status) {
      case 'connected':
        this.eventEmitter.emit('server:connected', { serverName });
        break;

      case 'disconnected':
        this.eventEmitter.emit('server:disconnected', { serverName });
        break;

      case 'reconnecting':
        this.eventEmitter.emit('server:reconnecting', { serverName });
        break;

      case 'error':
        const connection = this.connectionPool.getConnection(serverName);
        this.eventEmitter.emit('server:error', {
          serverName,
          error: connection?.getLastError(),
        });
        break;
    }
  }

  /**
   * Transform MCP content to ToolResultContent
   */
  private transformContent(content: {
    type: string;
    text?: string;
    data?: string;
    mimeType?: string;
  }): ToolResultContent {
    switch (content.type) {
      case 'text':
        return { type: 'text', text: content.text ?? '' };

      case 'image':
        return {
          type: 'image',
          data: content.data ?? '',
          mimeType: content.mimeType ?? 'image/png',
        };

      case 'resource':
        return {
          type: 'resource',
          resource: {
            uri: content.text ?? '',
            mimeType: content.mimeType,
          },
        };

      default:
        return { type: 'text', text: content.text ?? '' };
    }
  }

  /**
   * Convert base64 string to Uint8Array
   */
  private base64ToUint8Array(base64: string): Uint8Array {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }

  /**
   * Ensure client is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new MCPError('Client not initialized. Call initialize() first.', 'MCP_NOT_INITIALIZED');
    }
  }
}

/**
 * Create a new MCP client instance
 */
export function createMCPClient(options?: MCPClientOptions): IMCPClient {
  return new MCPClient(options);
}

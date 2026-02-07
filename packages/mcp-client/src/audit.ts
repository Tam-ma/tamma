/**
 * @tamma/mcp-client
 * Audit logging for MCP operations
 */

/**
 * Audit log entry types
 */
export type AuditEventType =
  | 'server:connect'
  | 'server:disconnect'
  | 'server:error'
  | 'tool:invoke'
  | 'tool:complete'
  | 'tool:error'
  | 'resource:read'
  | 'resource:error'
  | 'config:load'
  | 'config:validate';

/**
 * Audit log entry
 */
export interface AuditEntry {
  /** Unique entry ID */
  id: string;
  /** Timestamp of the event */
  timestamp: Date;
  /** Event type */
  type: AuditEventType;
  /** Server name (if applicable) */
  serverName?: string;
  /** Tool name (if applicable) */
  toolName?: string;
  /** Resource URI (if applicable) */
  resourceUri?: string;
  /** Operation succeeded */
  success: boolean;
  /** Duration in milliseconds (for completed operations) */
  durationMs?: number;
  /** Error message (if failed) */
  error?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Audit log output handler
 */
export type AuditOutputHandler = (entry: AuditEntry) => void | Promise<void>;

/**
 * Audit logger options
 */
export interface AuditLoggerOptions {
  /** Enable audit logging (default: true) */
  enabled?: boolean;
  /** Maximum entries to keep in memory (default: 1000) */
  maxEntries?: number;
  /** Redact sensitive fields from metadata (default: true) */
  redactSensitive?: boolean;
  /** Custom output handler */
  outputHandler?: AuditOutputHandler;
}

/**
 * Default audit logger options
 */
const DEFAULT_OPTIONS: Required<Omit<AuditLoggerOptions, 'outputHandler'>> = {
  enabled: true,
  maxEntries: 1000,
  redactSensitive: true,
};

/**
 * Sensitive field patterns to redact
 */
const SENSITIVE_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /key/i,
  /auth/i,
  /credential/i,
  /api[-_]?key/i,
];

/**
 * Audit logger for MCP operations
 *
 * Records all significant operations for compliance and debugging.
 */
export class AuditLogger {
  private entries: AuditEntry[] = [];
  private readonly options: Required<Omit<AuditLoggerOptions, 'outputHandler'>>;
  private readonly outputHandler?: AuditOutputHandler;
  private idCounter = 0;

  constructor(options: AuditLoggerOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.outputHandler = options.outputHandler;
  }

  /**
   * Log a server connection event
   */
  logServerConnect(serverName: string, success: boolean, error?: string): void {
    this.log({
      type: 'server:connect',
      serverName,
      success,
      error,
    });
  }

  /**
   * Log a server disconnection event
   */
  logServerDisconnect(serverName: string): void {
    this.log({
      type: 'server:disconnect',
      serverName,
      success: true,
    });
  }

  /**
   * Log a server error event
   */
  logServerError(serverName: string, error: string): void {
    this.log({
      type: 'server:error',
      serverName,
      success: false,
      error,
    });
  }

  /**
   * Log a tool invocation start
   */
  logToolInvoke(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>
  ): string {
    const id = this.generateId();

    this.log({
      id,
      type: 'tool:invoke',
      serverName,
      toolName,
      success: true, // Will be updated on completion
      metadata: this.redactSensitive({ args }),
    });

    return id;
  }

  /**
   * Log a tool invocation completion
   */
  logToolComplete(
    invocationId: string,
    serverName: string,
    toolName: string,
    success: boolean,
    durationMs: number,
    error?: string
  ): void {
    this.log({
      type: success ? 'tool:complete' : 'tool:error',
      serverName,
      toolName,
      success,
      durationMs,
      error,
      metadata: { invocationId },
    });
  }

  /**
   * Log a resource read
   */
  logResourceRead(
    serverName: string,
    resourceUri: string,
    success: boolean,
    durationMs?: number,
    error?: string
  ): void {
    this.log({
      type: success ? 'resource:read' : 'resource:error',
      serverName,
      resourceUri,
      success,
      durationMs,
      error,
    });
  }

  /**
   * Log a configuration load/validate event
   */
  logConfig(
    type: 'config:load' | 'config:validate',
    success: boolean,
    metadata?: Record<string, unknown>,
    error?: string
  ): void {
    this.log({
      type,
      success,
      metadata: this.redactSensitive(metadata),
      error,
    });
  }

  /**
   * Get all audit entries
   */
  getEntries(): AuditEntry[] {
    return [...this.entries];
  }

  /**
   * Get entries by type
   */
  getEntriesByType(type: AuditEventType): AuditEntry[] {
    return this.entries.filter((e) => e.type === type);
  }

  /**
   * Get entries for a server
   */
  getEntriesByServer(serverName: string): AuditEntry[] {
    return this.entries.filter((e) => e.serverName === serverName);
  }

  /**
   * Get entries in a time range
   */
  getEntriesInRange(start: Date, end: Date): AuditEntry[] {
    return this.entries.filter(
      (e) => e.timestamp >= start && e.timestamp <= end
    );
  }

  /**
   * Get failed entries
   */
  getFailedEntries(): AuditEntry[] {
    return this.entries.filter((e) => !e.success);
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.entries = [];
  }

  /**
   * Export entries as JSON
   */
  export(): string {
    return JSON.stringify(this.entries, null, 2);
  }

  /**
   * Get statistics
   */
  getStats(): AuditStats {
    const stats: AuditStats = {
      totalEntries: this.entries.length,
      byType: {},
      byServer: {},
      successRate: 0,
      failedCount: 0,
    };

    let successCount = 0;

    for (const entry of this.entries) {
      // Count by type
      stats.byType[entry.type] = (stats.byType[entry.type] ?? 0) + 1;

      // Count by server
      if (entry.serverName) {
        stats.byServer[entry.serverName] =
          (stats.byServer[entry.serverName] ?? 0) + 1;
      }

      // Count success/failure
      if (entry.success) {
        successCount += 1;
      } else {
        stats.failedCount += 1;
      }
    }

    stats.successRate =
      this.entries.length > 0 ? successCount / this.entries.length : 0;

    return stats;
  }

  /**
   * Internal log method
   */
  private log(
    entry: Omit<AuditEntry, 'id' | 'timestamp'> & { id?: string }
  ): void {
    if (!this.options.enabled) {
      return;
    }

    const fullEntry: AuditEntry = {
      id: entry.id ?? this.generateId(),
      timestamp: new Date(),
      ...entry,
    };

    // Add to memory
    this.entries.push(fullEntry);

    // Trim if over limit
    if (this.entries.length > this.options.maxEntries) {
      this.entries.splice(0, this.entries.length - this.options.maxEntries);
    }

    // Call output handler
    if (this.outputHandler) {
      void Promise.resolve(this.outputHandler(fullEntry));
    }
  }

  /**
   * Generate a unique ID
   */
  private generateId(): string {
    this.idCounter += 1;
    return `audit-${Date.now()}-${this.idCounter}`;
  }

  /**
   * Redact sensitive fields from metadata
   */
  private redactSensitive(
    metadata?: Record<string, unknown>
  ): Record<string, unknown> | undefined {
    if (!metadata || !this.options.redactSensitive) {
      return metadata;
    }

    const redacted: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(metadata)) {
      const isSensitive = SENSITIVE_PATTERNS.some((pattern) =>
        pattern.test(key)
      );

      if (isSensitive) {
        redacted[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        redacted[key] = this.redactSensitive(
          value as Record<string, unknown>
        );
      } else {
        redacted[key] = value;
      }
    }

    return redacted;
  }
}

/**
 * Audit statistics
 */
export interface AuditStats {
  totalEntries: number;
  byType: Record<string, number>;
  byServer: Record<string, number>;
  successRate: number;
  failedCount: number;
}

/**
 * Create a console output handler for audit logs
 */
export function createConsoleAuditHandler(): AuditOutputHandler {
  return (entry: AuditEntry) => {
    const prefix = entry.success ? '  ' : '!!';
    const time = entry.timestamp.toISOString();
    const server = entry.serverName ? `[${entry.serverName}]` : '';
    const tool = entry.toolName ? `tool:${entry.toolName}` : '';
    const resource = entry.resourceUri ? `resource:${entry.resourceUri}` : '';
    const duration = entry.durationMs ? `${entry.durationMs}ms` : '';
    const error = entry.error ? `ERROR: ${entry.error}` : '';

    console.log(
      `${prefix} ${time} ${entry.type} ${server} ${tool}${resource} ${duration} ${error}`.trim()
    );
  };
}

/**
 * Create a JSON lines output handler for audit logs
 */
export function createJsonLinesAuditHandler(
  writer: (line: string) => void
): AuditOutputHandler {
  return (entry: AuditEntry) => {
    writer(JSON.stringify(entry));
  };
}

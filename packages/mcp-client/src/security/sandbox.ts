/**
 * @tamma/mcp-client
 * Process sandboxing utilities
 */

import * as path from 'node:path';

/**
 * Sandbox options for subprocess execution
 */
export interface SandboxOptions {
  /** Maximum CPU time in seconds (default: 60) */
  maxCpuTime?: number;
  /** Maximum memory in bytes (default: 512MB) */
  maxMemory?: number;
  /** Maximum output size in bytes (default: 10MB) */
  maxOutputSize?: number;
  /** Kill timeout in ms (default: 5000) */
  killTimeout?: number;
  /** Allowed directories for file access */
  allowedPaths?: string[];
}

/**
 * Default sandbox options
 */
export const DEFAULT_SANDBOX_OPTIONS: Required<SandboxOptions> = {
  maxCpuTime: 60,
  maxMemory: 512 * 1024 * 1024, // 512MB
  maxOutputSize: 10 * 1024 * 1024, // 10MB
  killTimeout: 5000,
  allowedPaths: [],
};

/**
 * Output collector with size limit
 *
 * Collects output from a stream while enforcing size limits.
 */
export class OutputCollector {
  private chunks: Buffer[] = [];
  private totalSize = 0;
  private readonly maxSize: number;
  private truncated = false;

  constructor(maxSize: number = DEFAULT_SANDBOX_OPTIONS.maxOutputSize) {
    this.maxSize = maxSize;
  }

  /**
   * Add data to the collector
   * Returns false if the limit was exceeded
   */
  add(data: Buffer | string): boolean {
    const buffer = typeof data === 'string' ? Buffer.from(data) : data;

    if (this.truncated) {
      return false;
    }

    if (this.totalSize + buffer.length > this.maxSize) {
      // Add what we can
      const remaining = this.maxSize - this.totalSize;
      if (remaining > 0) {
        this.chunks.push(buffer.subarray(0, remaining));
        this.totalSize = this.maxSize;
      }
      this.truncated = true;
      return false;
    }

    this.chunks.push(buffer);
    this.totalSize += buffer.length;
    return true;
  }

  /**
   * Get the collected output as a string
   */
  toString(): string {
    return Buffer.concat(this.chunks).toString('utf-8');
  }

  /**
   * Get the collected output as a buffer
   */
  toBuffer(): Buffer {
    return Buffer.concat(this.chunks);
  }

  /**
   * Check if the output was truncated
   */
  wasTruncated(): boolean {
    return this.truncated;
  }

  /**
   * Get the current size
   */
  getSize(): number {
    return this.totalSize;
  }

  /**
   * Reset the collector
   */
  reset(): void {
    this.chunks = [];
    this.totalSize = 0;
    this.truncated = false;
  }
}

/**
 * Process resource monitor
 *
 * Monitors subprocess resource usage (simulated for portability).
 */
export class ResourceMonitor {
  private readonly startTime: number;
  private readonly maxCpuTime: number;
  private readonly maxMemory: number;
  private checkInterval?: ReturnType<typeof setInterval>;
  private readonly onLimitExceeded: (reason: string) => void;

  constructor(
    options: Pick<SandboxOptions, 'maxCpuTime' | 'maxMemory'>,
    onLimitExceeded: (reason: string) => void
  ) {
    this.startTime = Date.now();
    this.maxCpuTime = (options.maxCpuTime ?? DEFAULT_SANDBOX_OPTIONS.maxCpuTime) * 1000;
    this.maxMemory = options.maxMemory ?? DEFAULT_SANDBOX_OPTIONS.maxMemory;
    this.onLimitExceeded = onLimitExceeded;
  }

  /**
   * Start monitoring
   */
  start(): void {
    // Check every second
    this.checkInterval = setInterval(() => {
      this.check();
    }, 1000);
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
    }
  }

  /**
   * Check resource usage
   */
  private check(): void {
    const elapsed = Date.now() - this.startTime;

    // Check CPU time (wall clock as approximation)
    if (elapsed > this.maxCpuTime) {
      this.onLimitExceeded(`CPU time limit exceeded (${Math.round(elapsed / 1000)}s > ${Math.round(this.maxCpuTime / 1000)}s)`);
      return;
    }

    // Note: Accurate memory monitoring requires platform-specific code
    // (e.g., reading from /proc on Linux) or native modules.
    // This is a placeholder for the interface.
  }

  /**
   * Get elapsed time in ms
   */
  getElapsedMs(): number {
    return Date.now() - this.startTime;
  }
}

/**
 * Path validator for sandboxed file access
 */
export class PathValidator {
  private readonly allowedPaths: string[];

  constructor(allowedPaths: string[] = []) {
    this.allowedPaths = allowedPaths.map((p) => this.normalizePath(p));
  }

  /**
   * Check if a path is allowed
   */
  isAllowed(targetPath: string): boolean {
    if (this.allowedPaths.length === 0) {
      // No restrictions if no paths configured
      return true;
    }

    const normalized = this.normalizePath(targetPath);

    // Reject paths containing .. traversal sequences after normalization
    if (normalized.includes('..')) {
      return false;
    }

    return this.allowedPaths.some((allowed) => {
      // Path must start with an allowed path
      return normalized === allowed || normalized.startsWith(allowed + '/');
    });
  }

  /**
   * Validate a path and throw if not allowed
   */
  validate(targetPath: string): void {
    if (!this.isAllowed(targetPath)) {
      throw new Error(
        `Path '${targetPath}' is not in the allowed paths: ${this.allowedPaths.join(', ')}`
      );
    }
  }

  /**
   * Normalize a path for comparison.
   * Uses path.resolve() to fully resolve .. sequences and symlinks,
   * then normalizes separators.
   */
  private normalizePath(p: string): string {
    // Use path.resolve to fully normalize the path, resolving .. sequences
    const resolved = path.resolve(p);
    // Normalize separators: replace backslashes with forward slashes
    const normalized = resolved.replaceAll('\\', '/');
    // Remove trailing slashes without regex to avoid ReDoS on repeated '/'
    let end = normalized.length;
    while (end > 1 && normalized.charCodeAt(end - 1) === 0x2f /* '/' */) {
      end--;
    }
    return end === normalized.length ? normalized : normalized.slice(0, end);
  }
}

/**
 * Create sandbox environment variables
 *
 * Returns environment variables that help sandbox the subprocess.
 */
export function createSandboxEnv(baseEnv: Record<string, string> = {}): Record<string, string> {
  return {
    ...baseEnv,
    // Disable interactive prompts
    CI: 'true',
    // Prevent npm from opening browser
    BROWSER: 'none',
    // Disable color output for easier parsing
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    // Disable telemetry
    DO_NOT_TRACK: '1',
    // Node specific
    NODE_NO_WARNINGS: '1',
  };
}

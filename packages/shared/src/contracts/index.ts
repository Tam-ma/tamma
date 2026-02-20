/**
 * Interface definitions and contracts for the Tamma platform
 */

// Placeholder for shared contracts
export interface ILogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  /** Create a scoped child logger with additional context merged into every log entry. */
  child?(context: Record<string, unknown>): ILogger;
}

// Knowledge Base service contracts
export * from './knowledge-base/index.js';

// Engine transport contract
export * from './engine-transport.js';

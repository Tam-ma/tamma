import type { ILogger } from '@tamma/shared/contracts';
import type { LogEntry, LogLevel } from './types.js';

export type LogListener = (entry: LogEntry) => void;

export interface LogEmitter {
  emit: (level: LogLevel, message: string, context?: Record<string, unknown>) => void;
  subscribe: (listener: LogListener) => () => void;
  getHistory: () => readonly LogEntry[];
}

/**
 * Pub/sub for routing engine logs to the Ink UI.
 * Maintains a bounded history buffer + listener pattern (mirrors existing createStateEmitter).
 */
export function createLogEmitter(maxHistory = 1000): LogEmitter {
  const history: LogEntry[] = [];
  const listeners = new Set<LogListener>();

  const emitter: LogEmitter = {
    emit(level, message, context) {
      const entry: LogEntry = {
        level,
        message,
        timestamp: Date.now(),
        ...(context !== undefined ? { context } : {}),
      };

      history.push(entry);
      if (history.length > maxHistory) {
        history.shift();
      }

      for (const listener of listeners) {
        try {
          listener(entry);
        } catch {
          // Isolate listener errors so one failing listener
          // does not prevent subsequent listeners from being notified.
        }
      }
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getHistory() {
      return history;
    },
  };

  return emitter;
}

/**
 * Creates an ILogger that routes all calls through a LogEmitter.
 * Replaces pino in interactive mode so engine logs appear in the TUI instead of raw stdout.
 */
export function createLoggerBridge(emitter: LogEmitter): ILogger {
  return {
    debug(message: string, context?: Record<string, unknown>) {
      emitter.emit('debug', message, context);
    },
    info(message: string, context?: Record<string, unknown>) {
      emitter.emit('info', message, context);
    },
    warn(message: string, context?: Record<string, unknown>) {
      emitter.emit('warn', message, context);
    },
    error(message: string, context?: Record<string, unknown>) {
      emitter.emit('error', message, context);
    },
  };
}

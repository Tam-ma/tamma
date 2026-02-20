import pino from 'pino';
import type { ILogger } from '@tamma/shared';

export function createLogger(name: string, level?: string): ILogger {
  const options: pino.LoggerOptions = {
    name,
    level: level ?? 'info',
  };

  if (process.env['NODE_ENV'] !== 'production') {
    options.transport = { target: 'pino-pretty', options: { colorize: true } };
  }

  const pinoLogger = pino(options);

  return {
    debug(message: string, context?: Record<string, unknown>): void {
      if (context !== undefined) {
        pinoLogger.debug(context, message);
      } else {
        pinoLogger.debug(message);
      }
    },
    info(message: string, context?: Record<string, unknown>): void {
      if (context !== undefined) {
        pinoLogger.info(context, message);
      } else {
        pinoLogger.info(message);
      }
    },
    warn(message: string, context?: Record<string, unknown>): void {
      if (context !== undefined) {
        pinoLogger.warn(context, message);
      } else {
        pinoLogger.warn(message);
      }
    },
    error(message: string, context?: Record<string, unknown>): void {
      if (context !== undefined) {
        pinoLogger.error(context, message);
      } else {
        pinoLogger.error(message);
      }
    },
  };
}

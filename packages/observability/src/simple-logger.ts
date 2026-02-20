import type { ILogger } from '@tamma/shared';

const LEVELS: Record<string, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
};

function formatBindings(bindings: Record<string, unknown>): string {
  const entries = Object.entries(bindings);
  if (entries.length === 0) return '';
  return ' {' + entries.map(([k, v]) => `${k}=${String(v)}`).join(', ') + '}';
}

function write(
  levelName: string,
  threshold: number,
  name: string,
  bindings: Record<string, unknown>,
  message: string,
  context?: Record<string, unknown>,
): void {
  const levelNum = LEVELS[levelName] ?? 20;
  if (levelNum < threshold) return;

  const time = new Date().toISOString();
  const merged = context ? { ...bindings, ...context } : bindings;
  const suffix = formatBindings(merged);
  process.stderr.write(`[${time}] ${levelName.toUpperCase()} (${name}): ${message}${suffix}\n`);
}

function makeLogger(name: string, threshold: number, bindings: Record<string, unknown>): ILogger {
  return {
    debug(message: string, context?: Record<string, unknown>): void {
      write('debug', threshold, name, bindings, message, context);
    },
    info(message: string, context?: Record<string, unknown>): void {
      write('info', threshold, name, bindings, message, context);
    },
    warn(message: string, context?: Record<string, unknown>): void {
      write('warn', threshold, name, bindings, message, context);
    },
    error(message: string, context?: Record<string, unknown>): void {
      write('error', threshold, name, bindings, message, context);
    },
    child(childBindings: Record<string, unknown>): ILogger {
      return makeLogger(name, threshold, { ...bindings, ...childBindings });
    },
  };
}

export function createSimpleLogger(name: string, level?: string): ILogger {
  const threshold = LEVELS[level ?? 'info'] ?? 20;
  return makeLogger(name, threshold, {});
}

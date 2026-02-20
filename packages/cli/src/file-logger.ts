import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { LogListener } from './log-emitter.js';

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function createFileLogSubscriber(logDir?: string): { listener: LogListener; filePath: string; close: () => void } {
  const dir = logDir ?? path.join(os.homedir(), '.tamma', 'logs');
  fs.mkdirSync(dir, { recursive: true });

  const filePath = path.join(dir, `tamma-${formatDate(new Date())}.log`);

  // Open the fd synchronously so the file exists immediately for callers
  const fd = fs.openSync(filePath, 'a');
  const stream = fs.createWriteStream(filePath, { fd });

  const listener: LogListener = (entry) => {
    const iso = new Date(entry.timestamp).toISOString();
    const level = entry.level.toUpperCase().padEnd(5);
    let line = `[${iso}] [${level}] ${entry.message}`;
    if (entry.context !== undefined && Object.keys(entry.context).length > 0) {
      line += ` ${JSON.stringify(entry.context)}`;
    }
    stream.write(line + '\n');
  };

  const close = (): void => {
    stream.end();
  };

  return { listener, filePath, close };
}

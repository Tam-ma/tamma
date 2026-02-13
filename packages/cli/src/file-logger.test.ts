import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createFileLogSubscriber } from './file-logger.js';

describe('createFileLogSubscriber', () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir !== undefined) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should create a log file in the specified directory', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tamma-log-test-'));
    const { filePath } = createFileLogSubscriber(tempDir);

    expect(fs.existsSync(filePath)).toBe(true);
    expect(filePath).toContain('tamma-');
    expect(filePath).toContain('.log');
  });

  it('should write log entries to the file', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tamma-log-test-'));
    const { listener, filePath, close } = createFileLogSubscriber(tempDir);

    listener({
      level: 'info',
      message: 'Test log message',
      timestamp: Date.now(),
    });

    listener({
      level: 'error',
      message: 'Error message',
      timestamp: Date.now(),
      context: { key: 'value' },
    });

    // Close the stream to flush writes before reading
    await new Promise<void>((resolve) => { close(); setTimeout(resolve, 50); });
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('INFO');
    expect(content).toContain('Test log message');
    expect(content).toContain('ERROR');
    expect(content).toContain('Error message');
    expect(content).toContain('"key":"value"');
  });

  it('should format entries with ISO timestamps', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tamma-log-test-'));
    const { listener, filePath, close } = createFileLogSubscriber(tempDir);

    const timestamp = new Date('2026-02-12T10:30:00Z').getTime();
    listener({
      level: 'warn',
      message: 'Warning test',
      timestamp,
    });

    await new Promise<void>((resolve) => { close(); setTimeout(resolve, 50); });
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('2026-02-12T10:30:00.000Z');
    expect(content).toContain('WARN');
    expect(content).toContain('Warning test');
  });

  it('should not include context when empty', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tamma-log-test-'));
    const { listener, filePath, close } = createFileLogSubscriber(tempDir);

    listener({
      level: 'debug',
      message: 'No context',
      timestamp: Date.now(),
    });

    await new Promise<void>((resolve) => { close(); setTimeout(resolve, 50); });
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('No context');
    expect(content).not.toContain('{}');
  });

  it('should create directory if it does not exist', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tamma-log-test-'));
    const nestedDir = path.join(tempDir, 'nested', 'logs');

    const { filePath } = createFileLogSubscriber(nestedDir);
    expect(fs.existsSync(nestedDir)).toBe(true);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('should include date in filename', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tamma-log-test-'));
    const { filePath } = createFileLogSubscriber(tempDir);

    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    expect(filePath).toContain(`tamma-${y}-${m}-${d}.log`);
  });
});

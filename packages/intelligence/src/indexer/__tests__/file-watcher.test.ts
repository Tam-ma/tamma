/**
 * Tests for File Watcher Trigger
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { FileWatcher, createFileWatcher } from '../triggers/file-watcher.js';

describe('FileWatcher', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-watcher-test-'));
    // Create a subdirectory for watching
    fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('should create with default config', () => {
      const watcher = new FileWatcher({
        watchPaths: [tempDir],
      });

      expect(watcher.isRunning()).toBe(false);
    });

    it('should accept custom config', () => {
      const watcher = new FileWatcher({
        watchPaths: [tempDir],
        debounceMs: 200,
        extensions: ['.ts', '.js'],
        ignorePatterns: ['node_modules', '.git'],
      });

      expect(watcher.isRunning()).toBe(false);
    });
  });

  describe('start/stop', () => {
    it('should start watching', () => {
      const watcher = new FileWatcher({
        watchPaths: [tempDir],
      });

      const callback = vi.fn();
      watcher.start(callback);

      expect(watcher.isRunning()).toBe(true);
      expect(watcher.getWatcherCount()).toBe(1);

      watcher.stop();
      expect(watcher.isRunning()).toBe(false);
    });

    it('should not start twice', () => {
      const watcher = new FileWatcher({
        watchPaths: [tempDir],
      });

      const callback = vi.fn();
      watcher.start(callback);
      watcher.start(callback); // Should be a no-op

      expect(watcher.getWatcherCount()).toBe(1);

      watcher.stop();
    });

    it('should handle stopping when not started', () => {
      const watcher = new FileWatcher({
        watchPaths: [tempDir],
      });

      // Should not throw
      watcher.stop();
      expect(watcher.isRunning()).toBe(false);
    });

    it('should watch multiple directories', () => {
      const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'file-watcher-test2-'));

      try {
        const watcher = new FileWatcher({
          watchPaths: [tempDir, dir2],
        });

        const callback = vi.fn();
        watcher.start(callback);

        expect(watcher.getWatcherCount()).toBe(2);

        watcher.stop();
      } finally {
        fs.rmSync(dir2, { recursive: true, force: true });
      }
    });

    it('should skip non-existent directories', () => {
      const watcher = new FileWatcher({
        watchPaths: [tempDir, '/nonexistent/path/that/does/not/exist'],
      });

      const callback = vi.fn();
      watcher.start(callback);

      // Should only have 1 watcher (the existing dir)
      expect(watcher.getWatcherCount()).toBe(1);

      watcher.stop();
    });
  });

  describe('change detection', () => {
    it('should detect file creation with debouncing', async () => {
      const callback = vi.fn();
      const watcher = new FileWatcher({
        watchPaths: [tempDir],
        debounceMs: 100,
      });

      watcher.start(callback);

      // Create a file
      fs.writeFileSync(path.join(tempDir, 'src', 'test.ts'), 'const x = 1;');

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(callback).toHaveBeenCalled();
      if (callback.mock.calls.length > 0) {
        const changedFiles = callback.mock.calls[0][0] as string[];
        expect(changedFiles.length).toBeGreaterThan(0);
      }

      watcher.stop();
    });

    it('should debounce rapid changes', async () => {
      const callback = vi.fn();
      const watcher = new FileWatcher({
        watchPaths: [tempDir],
        debounceMs: 200,
      });

      watcher.start(callback);

      // Create multiple files rapidly
      fs.writeFileSync(path.join(tempDir, 'src', 'a.ts'), 'const a = 1;');
      fs.writeFileSync(path.join(tempDir, 'src', 'b.ts'), 'const b = 1;');
      fs.writeFileSync(path.join(tempDir, 'src', 'c.ts'), 'const c = 1;');

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Should have been called once (or few times due to debouncing)
      // The exact count depends on OS file system event coalescing
      expect(callback.mock.calls.length).toBeGreaterThan(0);

      watcher.stop();
    });

    it('should filter by extension', async () => {
      const callback = vi.fn();
      const watcher = new FileWatcher({
        watchPaths: [tempDir],
        debounceMs: 100,
        extensions: ['.ts'],
      });

      watcher.start(callback);

      // Create a .txt file (should be ignored)
      fs.writeFileSync(path.join(tempDir, 'readme.txt'), 'hello');

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Should NOT have been called for .txt file
      // Note: callback might be called 0 times (filtered) or with empty array
      if (callback.mock.calls.length > 0) {
        const changedFiles = callback.mock.calls[0][0] as string[];
        const hasTxt = changedFiles.some((f) => f.endsWith('.txt'));
        expect(hasTxt).toBe(false);
      }

      watcher.stop();
    });

    it('should ignore patterns', async () => {
      // Create a node_modules directory
      fs.mkdirSync(path.join(tempDir, 'node_modules', 'pkg'), { recursive: true });

      const callback = vi.fn();
      const watcher = new FileWatcher({
        watchPaths: [tempDir],
        debounceMs: 100,
      });

      watcher.start(callback);

      // Create a file in node_modules
      fs.writeFileSync(
        path.join(tempDir, 'node_modules', 'pkg', 'index.js'),
        'module.exports = {};',
      );

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Check that node_modules files were ignored
      if (callback.mock.calls.length > 0) {
        const changedFiles = callback.mock.calls[0][0] as string[];
        const hasNodeModules = changedFiles.some((f) => f.includes('node_modules'));
        expect(hasNodeModules).toBe(false);
      }

      watcher.stop();
    });
  });
});

describe('createFileWatcher', () => {
  it('should create a file watcher instance', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-factory-'));
    try {
      const watcher = createFileWatcher({ watchPaths: [tempDir] });
      expect(watcher).toBeInstanceOf(FileWatcher);
      expect(watcher.isRunning()).toBe(false);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

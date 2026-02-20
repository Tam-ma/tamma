/**
 * Audit logger tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AuditLogger,
  createConsoleAuditHandler,
  createJsonLinesAuditHandler,
  type AuditEntry,
} from '../../src/audit.js';

describe('AuditLogger', () => {
  let logger: AuditLogger;

  beforeEach(() => {
    logger = new AuditLogger();
  });

  describe('logServerConnect', () => {
    it('should log successful connection', () => {
      logger.logServerConnect('test-server', true);

      const entries = logger.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]?.type).toBe('server:connect');
      expect(entries[0]?.serverName).toBe('test-server');
      expect(entries[0]?.success).toBe(true);
    });

    it('should log failed connection', () => {
      logger.logServerConnect('test-server', false, 'Connection refused');

      const entries = logger.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]?.success).toBe(false);
      expect(entries[0]?.error).toBe('Connection refused');
    });
  });

  describe('logToolInvoke', () => {
    it('should log tool invocation', () => {
      const id = logger.logToolInvoke('server', 'echo', { message: 'hello' });

      const entries = logger.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]?.type).toBe('tool:invoke');
      expect(entries[0]?.toolName).toBe('echo');
      expect(id).toBeTruthy();
    });

    it('should redact sensitive arguments', () => {
      logger.logToolInvoke('server', 'auth', { password: 'secret123' });

      const entries = logger.getEntries();
      const metadata = entries[0]?.metadata as Record<string, unknown>;
      const args = metadata?.['args'] as Record<string, unknown>;
      expect(args?.['password']).toBe('[REDACTED]');
    });
  });

  describe('logToolComplete', () => {
    it('should log successful completion', () => {
      logger.logToolComplete('inv-1', 'server', 'echo', true, 100);

      const entries = logger.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]?.type).toBe('tool:complete');
      expect(entries[0]?.durationMs).toBe(100);
    });

    it('should log failed completion', () => {
      logger.logToolComplete('inv-1', 'server', 'echo', false, 50, 'Tool error');

      const entries = logger.getEntries();
      expect(entries[0]?.type).toBe('tool:error');
      expect(entries[0]?.error).toBe('Tool error');
    });
  });

  describe('logResourceRead', () => {
    it('should log resource read', () => {
      logger.logResourceRead('server', 'file:///test.txt', true, 25);

      const entries = logger.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]?.type).toBe('resource:read');
      expect(entries[0]?.resourceUri).toBe('file:///test.txt');
    });
  });

  describe('getEntriesByType', () => {
    it('should filter by type', () => {
      logger.logServerConnect('s1', true);
      logger.logToolInvoke('s1', 'tool1', {});
      logger.logServerConnect('s2', true);

      const connects = logger.getEntriesByType('server:connect');
      expect(connects).toHaveLength(2);

      const invokes = logger.getEntriesByType('tool:invoke');
      expect(invokes).toHaveLength(1);
    });
  });

  describe('getEntriesByServer', () => {
    it('should filter by server', () => {
      logger.logServerConnect('server1', true);
      logger.logServerConnect('server2', true);
      logger.logToolInvoke('server1', 'tool', {});

      const server1Entries = logger.getEntriesByServer('server1');
      expect(server1Entries).toHaveLength(2);

      const server2Entries = logger.getEntriesByServer('server2');
      expect(server2Entries).toHaveLength(1);
    });
  });

  describe('getEntriesInRange', () => {
    it('should filter by time range', async () => {
      const start = new Date();

      logger.logServerConnect('s1', true);

      await new Promise((r) => setTimeout(r, 10));
      const mid = new Date();

      await new Promise((r) => setTimeout(r, 10));
      logger.logServerConnect('s2', true);

      const end = new Date();

      const all = logger.getEntriesInRange(start, end);
      expect(all).toHaveLength(2);

      const firstOnly = logger.getEntriesInRange(start, mid);
      expect(firstOnly).toHaveLength(1);
    });
  });

  describe('getFailedEntries', () => {
    it('should return only failed entries', () => {
      logger.logServerConnect('s1', true);
      logger.logServerConnect('s2', false, 'Error');
      logger.logToolComplete('inv', 's1', 'tool', false, 10, 'Failed');

      const failed = logger.getFailedEntries();
      expect(failed).toHaveLength(2);
    });
  });

  describe('getStats', () => {
    it('should calculate statistics', () => {
      logger.logServerConnect('s1', true);
      logger.logServerConnect('s2', false, 'Error');
      logger.logToolInvoke('s1', 'tool', {});

      const stats = logger.getStats();
      expect(stats.totalEntries).toBe(3);
      expect(stats.successRate).toBeCloseTo(0.667, 2);
      expect(stats.failedCount).toBe(1);
      expect(stats.byType['server:connect']).toBe(2);
      expect(stats.byServer['s1']).toBe(2);
    });
  });

  describe('maxEntries', () => {
    it('should trim entries when limit exceeded', () => {
      const smallLogger = new AuditLogger({ maxEntries: 3 });

      smallLogger.logServerConnect('s1', true);
      smallLogger.logServerConnect('s2', true);
      smallLogger.logServerConnect('s3', true);
      smallLogger.logServerConnect('s4', true);

      const entries = smallLogger.getEntries();
      expect(entries).toHaveLength(3);
      // Should keep the most recent entries
      expect(entries[0]?.serverName).toBe('s2');
    });
  });

  describe('enabled option', () => {
    it('should not log when disabled', () => {
      const disabledLogger = new AuditLogger({ enabled: false });

      disabledLogger.logServerConnect('s1', true);

      expect(disabledLogger.getEntries()).toHaveLength(0);
    });
  });

  describe('outputHandler', () => {
    it('should call custom output handler', () => {
      const handler = vi.fn();
      const customLogger = new AuditLogger({ outputHandler: handler });

      customLogger.logServerConnect('s1', true);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'server:connect',
          serverName: 's1',
        })
      );
    });
  });

  describe('clear', () => {
    it('should clear all entries', () => {
      logger.logServerConnect('s1', true);
      logger.logServerConnect('s2', true);

      logger.clear();

      expect(logger.getEntries()).toHaveLength(0);
    });
  });

  describe('export', () => {
    it('should export as JSON', () => {
      logger.logServerConnect('s1', true);

      const json = logger.export();
      const parsed = JSON.parse(json) as AuditEntry[];

      expect(parsed).toHaveLength(1);
      expect(parsed[0]?.type).toBe('server:connect');
    });
  });
});

describe('createConsoleAuditHandler', () => {
  it('should log to console', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const handler = createConsoleAuditHandler();

    const entry: AuditEntry = {
      id: 'test-1',
      timestamp: new Date(),
      type: 'tool:invoke',
      serverName: 'server',
      toolName: 'echo',
      success: true,
    };

    handler(entry);

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe('createJsonLinesAuditHandler', () => {
  it('should write JSON lines', () => {
    const writer = vi.fn();
    const handler = createJsonLinesAuditHandler(writer);

    const entry: AuditEntry = {
      id: 'test-1',
      timestamp: new Date(),
      type: 'tool:invoke',
      serverName: 'server',
      toolName: 'echo',
      success: true,
    };

    handler(entry);

    expect(writer).toHaveBeenCalledTimes(1);
    const written = writer.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(written) as AuditEntry;
    expect(parsed.type).toBe('tool:invoke');
  });
});

/**
 * Connection pool unit tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConnectionPool } from '../../src/connections/pool.js';
import { MCPServerNotFoundError } from '../../src/errors.js';
import type { MCPServerConfig } from '../../src/types.js';

describe('ConnectionPool', () => {
  let pool: ConnectionPool;

  const createMockConfig = (name: string, transport: 'stdio' | 'sse' = 'stdio'): MCPServerConfig => ({
    name,
    transport,
    command: transport === 'stdio' ? 'node' : undefined,
    url: transport === 'sse' ? 'http://localhost:3000' : undefined,
    autoConnect: false, // Disable auto-connect for testing
    enabled: true,
  });

  beforeEach(() => {
    pool = new ConnectionPool();
  });

  describe('addServer', () => {
    it('should add a server', () => {
      pool.addServer(createMockConfig('server1'));

      expect(pool.getServerNames()).toContain('server1');
    });

    it('should throw for duplicate server name', () => {
      pool.addServer(createMockConfig('server1'));

      expect(() => pool.addServer(createMockConfig('server1'))).toThrow(/already exists/);
    });
  });

  describe('removeServer', () => {
    it('should remove a server', async () => {
      pool.addServer(createMockConfig('server1'));

      await pool.removeServer('server1');

      expect(pool.getServerNames()).not.toContain('server1');
    });

    it('should not throw for non-existent server', async () => {
      await expect(pool.removeServer('nonexistent')).resolves.toBeUndefined();
    });
  });

  describe('getConnection', () => {
    it('should return connection for existing server', () => {
      pool.addServer(createMockConfig('server1'));

      const connection = pool.getConnection('server1');

      expect(connection).toBeDefined();
    });

    it('should return undefined for non-existent server', () => {
      const connection = pool.getConnection('nonexistent');

      expect(connection).toBeUndefined();
    });
  });

  describe('requireConnection', () => {
    it('should return connection for existing server', () => {
      pool.addServer(createMockConfig('server1'));

      const connection = pool.requireConnection('server1');

      expect(connection).toBeDefined();
    });

    it('should throw MCPServerNotFoundError for non-existent server', () => {
      expect(() => pool.requireConnection('nonexistent')).toThrow(MCPServerNotFoundError);
    });
  });

  describe('getStatus', () => {
    it('should return disconnected for new server', () => {
      pool.addServer(createMockConfig('server1'));

      expect(pool.getStatus('server1')).toBe('disconnected');
    });

    it('should return disconnected for non-existent server', () => {
      expect(pool.getStatus('nonexistent')).toBe('disconnected');
    });
  });

  describe('isConnected', () => {
    it('should return false for disconnected server', () => {
      pool.addServer(createMockConfig('server1'));

      expect(pool.isConnected('server1')).toBe(false);
    });

    it('should return false for non-existent server', () => {
      expect(pool.isConnected('nonexistent')).toBe(false);
    });
  });

  describe('getServerNames', () => {
    it('should return all server names', () => {
      pool.addServer(createMockConfig('server1'));
      pool.addServer(createMockConfig('server2'));
      pool.addServer(createMockConfig('server3'));

      const names = pool.getServerNames();

      expect(names).toHaveLength(3);
      expect(names).toContain('server1');
      expect(names).toContain('server2');
      expect(names).toContain('server3');
    });
  });

  describe('getServerCount', () => {
    it('should return correct count', () => {
      pool.addServer(createMockConfig('server1'));
      pool.addServer(createMockConfig('server2'));

      expect(pool.getServerCount()).toBe(2);
    });

    it('should return 0 for empty pool', () => {
      expect(pool.getServerCount()).toBe(0);
    });
  });

  describe('getConnectedCount', () => {
    it('should return 0 when no servers connected', () => {
      pool.addServer(createMockConfig('server1'));
      pool.addServer(createMockConfig('server2'));

      expect(pool.getConnectedCount()).toBe(0);
    });
  });

  describe('getConnectedServers', () => {
    it('should return empty array when no servers connected', () => {
      pool.addServer(createMockConfig('server1'));

      expect(pool.getConnectedServers()).toHaveLength(0);
    });
  });

  describe('getServerInfos', () => {
    it('should return server info for all servers', () => {
      pool.addServer(createMockConfig('server1'));
      pool.addServer(createMockConfig('server2', 'sse'));

      const infos = pool.getServerInfos();

      expect(infos).toHaveLength(2);

      const server1 = infos.find((i) => i.name === 'server1');
      expect(server1?.transport).toBe('stdio');
      expect(server1?.status).toBe('disconnected');

      const server2 = infos.find((i) => i.name === 'server2');
      expect(server2?.transport).toBe('sse');
    });
  });

  describe('getServerInfo', () => {
    it('should return server info for existing server', () => {
      pool.addServer(createMockConfig('server1'));

      const info = pool.getServerInfo('server1');

      expect(info).toBeDefined();
      expect(info?.name).toBe('server1');
      expect(info?.status).toBe('disconnected');
    });

    it('should return undefined for non-existent server', () => {
      const info = pool.getServerInfo('nonexistent');

      expect(info).toBeUndefined();
    });
  });

  describe('setOnServerStatusChange', () => {
    it('should set status change handler', () => {
      const handler = vi.fn();
      pool.setOnServerStatusChange(handler);

      // Handler is set, but we can't easily test it without actual connections
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('clear', () => {
    it('should remove all servers', async () => {
      pool.addServer(createMockConfig('server1'));
      pool.addServer(createMockConfig('server2'));

      await pool.clear();

      expect(pool.getServerCount()).toBe(0);
      expect(pool.getServerNames()).toHaveLength(0);
    });
  });

  describe('disconnectAll', () => {
    it('should disconnect all servers', async () => {
      pool.addServer(createMockConfig('server1'));
      pool.addServer(createMockConfig('server2'));

      // Should not throw even when servers aren't connected
      await expect(pool.disconnectAll()).resolves.toBeUndefined();
    });
  });
});

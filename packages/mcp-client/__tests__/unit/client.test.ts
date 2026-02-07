/**
 * MCP Client unit tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MCPClient, createMCPClient } from '../../src/client.js';
import { MCPError, MCPValidationError } from '../../src/errors.js';
import type { MCPClientConfig } from '../../src/types.js';

describe('MCPClient', () => {
  let client: MCPClient;

  const validConfig: MCPClientConfig = {
    servers: [
      {
        name: 'test-server',
        transport: 'stdio',
        command: 'node',
        args: ['./mock-server.js'],
        enabled: true,
        autoConnect: false, // Disable auto-connect for testing
      },
    ],
    defaultTimeout: 5000,
    retryAttempts: 2,
    retryDelayMs: 100,
    enableCaching: true,
    cacheTTLMs: 60000,
    logLevel: 'warn',
  };

  beforeEach(() => {
    client = new MCPClient();
  });

  describe('createMCPClient', () => {
    it('should create a new client instance', () => {
      const client = createMCPClient();
      expect(client).toBeDefined();
    });
  });

  describe('initialize', () => {
    it('should initialize with valid config', async () => {
      await client.initialize(validConfig);

      const servers = client.listServers();
      expect(servers).toHaveLength(1);
      expect(servers[0]?.name).toBe('test-server');
    });

    it('should throw for invalid config', async () => {
      await expect(client.initialize({} as MCPClientConfig)).rejects.toThrow(
        MCPValidationError
      );
    });

    it('should throw for empty servers array', async () => {
      await expect(
        client.initialize({ ...validConfig, servers: [] })
      ).rejects.toThrow(MCPValidationError);
    });

    it('should throw when already initialized', async () => {
      await client.initialize(validConfig);

      await expect(client.initialize(validConfig)).rejects.toThrow(MCPError);
    });

    it('should skip disabled servers', async () => {
      const config: MCPClientConfig = {
        ...validConfig,
        servers: [
          {
            name: 'enabled-server',
            transport: 'stdio',
            command: 'node',
            enabled: true,
            autoConnect: false,
          },
          {
            name: 'disabled-server',
            transport: 'stdio',
            command: 'node',
            enabled: false,
            autoConnect: false,
          },
        ],
      };

      await client.initialize(config);

      const servers = client.listServers();
      expect(servers).toHaveLength(1);
      expect(servers[0]?.name).toBe('enabled-server');
    });
  });

  describe('dispose', () => {
    it('should dispose client', async () => {
      await client.initialize(validConfig);
      await client.dispose();

      // Should be able to initialize again after dispose
      const newClient = new MCPClient();
      await newClient.initialize(validConfig);
      await newClient.dispose();
    });

    it('should clear all state', async () => {
      await client.initialize(validConfig);
      await client.dispose();

      // Operations should fail after dispose (not initialized)
      expect(() => client.listTools()).toThrow(MCPError);
    });
  });

  describe('getServerStatus', () => {
    it('should return disconnected for new server', async () => {
      await client.initialize(validConfig);

      const status = client.getServerStatus('test-server');
      expect(status).toBe('disconnected');
    });

    it('should throw when not initialized', () => {
      expect(() => client.getServerStatus('test-server')).toThrow(MCPError);
    });
  });

  describe('getServerInfo', () => {
    it('should return server info', async () => {
      await client.initialize(validConfig);

      const info = client.getServerInfo('test-server');

      expect(info).toBeDefined();
      expect(info?.name).toBe('test-server');
      expect(info?.transport).toBe('stdio');
      expect(info?.status).toBe('disconnected');
    });

    it('should return undefined for non-existent server', async () => {
      await client.initialize(validConfig);

      const info = client.getServerInfo('nonexistent');

      expect(info).toBeUndefined();
    });
  });

  describe('listServers', () => {
    it('should list all servers', async () => {
      const config: MCPClientConfig = {
        ...validConfig,
        servers: [
          { name: 'server1', transport: 'stdio', command: 'node', autoConnect: false },
          { name: 'server2', transport: 'stdio', command: 'node', autoConnect: false },
        ],
      };

      await client.initialize(config);

      const servers = client.listServers();

      expect(servers).toHaveLength(2);
      expect(servers.map((s) => s.name)).toContain('server1');
      expect(servers.map((s) => s.name)).toContain('server2');
    });
  });

  describe('listTools', () => {
    it('should return empty array when no tools', async () => {
      await client.initialize(validConfig);

      const tools = client.listTools();

      expect(tools).toHaveLength(0);
    });

    it('should throw when not initialized', () => {
      expect(() => client.listTools()).toThrow(MCPError);
    });
  });

  describe('listResources', () => {
    it('should return empty array when no resources', async () => {
      await client.initialize(validConfig);

      const resources = client.listResources();

      expect(resources).toHaveLength(0);
    });
  });

  describe('getToolSchema', () => {
    it('should return undefined when tool not found', async () => {
      await client.initialize(validConfig);

      const schema = client.getToolSchema('test-server', 'nonexistent');

      expect(schema).toBeUndefined();
    });
  });

  describe('event handling', () => {
    it('should register and unregister event handlers', async () => {
      await client.initialize(validConfig);

      const handler = vi.fn();
      const unsubscribe = client.on('server:connected', handler);

      expect(typeof unsubscribe).toBe('function');

      unsubscribe();
    });
  });

  describe('healthCheck', () => {
    it('should return health check result', async () => {
      await client.initialize(validConfig);

      const health = await client.healthCheck();

      expect(health).toBeDefined();
      expect(typeof health.healthy).toBe('boolean');
      expect(health.servers).toBeDefined();
      expect(health.servers['test-server']).toBeDefined();
    });

    it('should report unhealthy when no servers connected', async () => {
      await client.initialize(validConfig);

      const health = await client.healthCheck();

      expect(health.healthy).toBe(false);
      expect(health.servers['test-server']?.status).toBe('disconnected');
    });
  });

  describe('resource subscription', () => {
    it('should allow subscribing to resources', async () => {
      await client.initialize(validConfig);

      const callback = vi.fn();
      const unsubscribe = client.subscribeResource('test-server', 'file:///test.txt', callback);

      expect(typeof unsubscribe).toBe('function');

      unsubscribe();
    });

    it('should call unsubscribe function', async () => {
      await client.initialize(validConfig);

      const callback1 = vi.fn();
      const callback2 = vi.fn();

      const unsub1 = client.subscribeResource('test-server', 'file:///test.txt', callback1);
      const unsub2 = client.subscribeResource('test-server', 'file:///test.txt', callback2);

      unsub1();

      // Both subscriptions should be independent
      expect(typeof unsub2).toBe('function');
    });
  });
});

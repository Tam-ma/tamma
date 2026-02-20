/**
 * Multi-server integration tests
 *
 * These tests verify the behavior of the MCP client with multiple servers.
 * Skipped by default - run with: pnpm test:integration
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MCPClient, createMCPClient } from '../../src/client.js';
import type { MCPClientConfig } from '../../src/types.js';

describe.skip('Multi-Server Integration', () => {
  let client: MCPClient;

  const config: MCPClientConfig = {
    servers: [
      {
        name: 'server1',
        transport: 'stdio',
        command: 'npx',
        args: ['@modelcontextprotocol/server-everything'],
        enabled: true,
        autoConnect: false,
      },
      {
        name: 'server2',
        transport: 'stdio',
        command: 'npx',
        args: ['@modelcontextprotocol/server-filesystem', '/tmp'],
        enabled: true,
        autoConnect: false,
      },
    ],
    defaultTimeout: 30000,
    retryAttempts: 2,
    retryDelayMs: 1000,
    enableCaching: true,
    cacheTTLMs: 60000,
    logLevel: 'info',
  };

  beforeAll(async () => {
    client = createMCPClient() as MCPClient;
    await client.initialize(config);
  });

  afterAll(async () => {
    if (client) {
      await client.dispose();
    }
  });

  describe('multiple connections', () => {
    it('should connect to multiple servers', async () => {
      await Promise.all([
        client.connectServer('server1'),
        client.connectServer('server2'),
      ]);

      expect(client.getServerStatus('server1')).toBe('connected');
      expect(client.getServerStatus('server2')).toBe('connected');
    });

    it('should list tools from all servers', async () => {
      await Promise.all([
        client.connectServer('server1'),
        client.connectServer('server2'),
      ]);

      const allTools = client.listTools();
      const server1Tools = client.listTools('server1');
      const server2Tools = client.listTools('server2');

      expect(allTools.length).toBe(server1Tools.length + server2Tools.length);
    });

    it('should disconnect from specific server', async () => {
      await Promise.all([
        client.connectServer('server1'),
        client.connectServer('server2'),
      ]);

      await client.disconnectServer('server1');

      expect(client.getServerStatus('server1')).toBe('disconnected');
      expect(client.getServerStatus('server2')).toBe('connected');
    });
  });

  describe('server isolation', () => {
    it('should namespace tools by server', async () => {
      await Promise.all([
        client.connectServer('server1'),
        client.connectServer('server2'),
      ]);

      const server1Tools = client.listTools('server1');
      const server2Tools = client.listTools('server2');

      // All tools should have correct serverName
      server1Tools.forEach((tool) => {
        expect(tool.serverName).toBe('server1');
      });

      server2Tools.forEach((tool) => {
        expect(tool.serverName).toBe('server2');
      });
    });
  });

  describe('health check', () => {
    it('should check health of all servers', async () => {
      await Promise.all([
        client.connectServer('server1'),
        client.connectServer('server2'),
      ]);

      const health = await client.healthCheck();

      expect(health.servers['server1']).toBeDefined();
      expect(health.servers['server2']).toBeDefined();
    });

    it('should report unhealthy when one server fails', async () => {
      await client.connectServer('server1');
      // server2 not connected

      const health = await client.healthCheck();

      expect(health.healthy).toBe(false);
      expect(health.servers['server1']?.status).toBe('connected');
      expect(health.servers['server2']?.status).toBe('disconnected');
    });
  });
});

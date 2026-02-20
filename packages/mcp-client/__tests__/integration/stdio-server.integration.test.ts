/**
 * Stdio server integration tests
 *
 * These tests require actual MCP server processes and are skipped by default.
 * Run with: pnpm test:integration
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MCPClient, createMCPClient } from '../../src/client.js';
import type { MCPClientConfig } from '../../src/types.js';

describe.skip('Stdio Server Integration', () => {
  let client: MCPClient;

  const config: MCPClientConfig = {
    servers: [
      {
        name: 'test-server',
        transport: 'stdio',
        command: 'npx',
        args: ['@modelcontextprotocol/server-everything'],
        enabled: true,
        autoConnect: false,
        timeout: 10000,
      },
    ],
    defaultTimeout: 30000,
    retryAttempts: 2,
    retryDelayMs: 1000,
    enableCaching: true,
    cacheTTLMs: 60000,
    logLevel: 'debug',
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

  describe('connection', () => {
    it('should connect to server', async () => {
      await client.connectServer('test-server');

      const status = client.getServerStatus('test-server');
      expect(status).toBe('connected');
    });

    it('should disconnect from server', async () => {
      await client.connectServer('test-server');
      await client.disconnectServer('test-server');

      const status = client.getServerStatus('test-server');
      expect(status).toBe('disconnected');
    });
  });

  describe('tool discovery', () => {
    it('should list tools after connection', async () => {
      await client.connectServer('test-server');

      const tools = client.listTools('test-server');
      expect(tools.length).toBeGreaterThan(0);
    });
  });

  describe('tool invocation', () => {
    it('should invoke echo tool', async () => {
      await client.connectServer('test-server');

      const result = await client.invokeTool('test-server', 'echo', {
        message: 'Hello, World!',
      });

      expect(result.success).toBe(true);
      expect(result.content[0]?.type).toBe('text');
    });
  });

  describe('resource operations', () => {
    it('should list resources', async () => {
      await client.connectServer('test-server');

      const resources = client.listResources('test-server');
      // Resources may or may not be available depending on server
      expect(Array.isArray(resources)).toBe(true);
    });
  });

  describe('health check', () => {
    it('should return health status', async () => {
      await client.connectServer('test-server');

      const health = await client.healthCheck();

      expect(health.healthy).toBe(true);
      expect(health.servers['test-server']?.status).toBe('connected');
    });
  });
});

/**
 * Mock MCP Server unit tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MockMCPServer, createSampleMockServer } from '../mocks/mock-mcp-server.js';
import type { JSONRPCRequest } from '../../src/utils/json-rpc.js';

describe('MockMCPServer', () => {
  let server: MockMCPServer;

  beforeEach(() => {
    server = new MockMCPServer('test-server');
  });

  describe('initialize', () => {
    it('should handle initialize request', async () => {
      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0.0' },
        },
      };

      const response = await server.handleRequest(request);

      expect(response.result).toBeDefined();
      expect(response.error).toBeUndefined();

      const result = response.result as {
        protocolVersion: string;
        capabilities: object;
        serverInfo: { name: string; version: string };
      };
      expect(result.protocolVersion).toBe('2024-11-05');
      expect(result.serverInfo.name).toBe('test-server');
    });
  });

  describe('tools', () => {
    it('should list added tools', async () => {
      server.addTool({
        name: 'my-tool',
        description: 'A test tool',
        inputSchema: { type: 'object' },
        handler: () => 'result',
      });

      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
      };

      const response = await server.handleRequest(request);
      const result = response.result as { tools: Array<{ name: string }> };

      expect(result.tools).toHaveLength(1);
      expect(result.tools[0]?.name).toBe('my-tool');
    });

    it('should call tool handler', async () => {
      const handler = vi.fn().mockReturnValue({ result: 'success' });

      server.addTool({
        name: 'my-tool',
        description: 'A test tool',
        inputSchema: { type: 'object' },
        handler,
      });

      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'my-tool',
          arguments: { key: 'value' },
        },
      };

      const response = await server.handleRequest(request);

      expect(handler).toHaveBeenCalledWith({ key: 'value' });
      expect(response.error).toBeUndefined();
    });

    it('should handle tool error', async () => {
      server.addTool({
        name: 'failing-tool',
        description: 'A tool that fails',
        inputSchema: { type: 'object' },
        handler: () => {
          throw new Error('Tool execution failed');
        },
      });

      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'failing-tool' },
      };

      const response = await server.handleRequest(request);
      const result = response.result as { isError: boolean };

      expect(result.isError).toBe(true);
    });

    it('should return error for non-existent tool', async () => {
      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'nonexistent' },
      };

      const response = await server.handleRequest(request);

      expect(response.error).toBeDefined();
      expect(response.error?.message).toContain('nonexistent');
    });
  });

  describe('resources', () => {
    it('should list added resources', async () => {
      server.addResource({
        uri: 'file:///test.txt',
        name: 'test.txt',
        content: { text: 'Hello' },
      });

      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: 6,
        method: 'resources/list',
      };

      const response = await server.handleRequest(request);
      const result = response.result as { resources: Array<{ uri: string }> };

      expect(result.resources).toHaveLength(1);
      expect(result.resources[0]?.uri).toBe('file:///test.txt');
    });

    it('should read resource content', async () => {
      server.addResource({
        uri: 'file:///test.txt',
        name: 'test.txt',
        mimeType: 'text/plain',
        content: { text: 'Hello, World!' },
      });

      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: 7,
        method: 'resources/read',
        params: { uri: 'file:///test.txt' },
      };

      const response = await server.handleRequest(request);
      const result = response.result as {
        contents: Array<{ uri: string; text: string }>;
      };

      expect(result.contents[0]?.text).toBe('Hello, World!');
    });

    it('should return error for non-existent resource', async () => {
      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: 8,
        method: 'resources/read',
        params: { uri: 'file:///nonexistent.txt' },
      };

      const response = await server.handleRequest(request);

      expect(response.error).toBeDefined();
    });
  });

  describe('prompts', () => {
    it('should list added prompts', async () => {
      server.addPrompt({
        name: 'greeting',
        description: 'Generate a greeting',
        arguments: [{ name: 'name', required: true }],
      });

      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: 9,
        method: 'prompts/list',
      };

      const response = await server.handleRequest(request);
      const result = response.result as { prompts: Array<{ name: string }> };

      expect(result.prompts).toHaveLength(1);
      expect(result.prompts[0]?.name).toBe('greeting');
    });
  });

  describe('ping', () => {
    it('should handle ping request', async () => {
      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: 10,
        method: 'ping',
      };

      const response = await server.handleRequest(request);

      expect(response.error).toBeUndefined();
      expect(response.result).toEqual({});
    });
  });

  describe('latency simulation', () => {
    it('should delay response', async () => {
      server.setLatency(100);

      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: 11,
        method: 'ping',
      };

      const start = Date.now();
      await server.handleRequest(request);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(90); // Allow some timing variance
    });
  });

  describe('error simulation', () => {
    it('should simulate error for method', async () => {
      server.simulateError('tools/list', new Error('Simulated error'));

      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: 12,
        method: 'tools/list',
      };

      const response = await server.handleRequest(request);

      expect(response.error).toBeDefined();
      expect(response.error?.message).toBe('Simulated error');
    });

    it('should clear simulated error', async () => {
      server.simulateError('ping', new Error('Error'));
      server.clearError('ping');

      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: 13,
        method: 'ping',
      };

      const response = await server.handleRequest(request);

      expect(response.error).toBeUndefined();
    });
  });

  describe('reset', () => {
    it('should clear all state', async () => {
      server.addTool({
        name: 'tool',
        description: '',
        inputSchema: {},
        handler: () => {},
      });
      server.setLatency(100);
      server.simulateError('ping', new Error('Error'));

      server.reset();

      expect(server.getTools()).toHaveLength(0);
      expect(server.getResources()).toHaveLength(0);

      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: 14,
        method: 'ping',
      };

      const start = Date.now();
      const response = await server.handleRequest(request);
      const elapsed = Date.now() - start;

      expect(response.error).toBeUndefined();
      expect(elapsed).toBeLessThan(50); // No latency
    });
  });

  describe('method not found', () => {
    it('should return error for unknown method', async () => {
      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: 15,
        method: 'unknown/method',
      };

      const response = await server.handleRequest(request);

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(-32601);
    });
  });
});

describe('createSampleMockServer', () => {
  it('should create a server with sample tools', () => {
    const server = createSampleMockServer();

    const tools = server.getTools();
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.some((t) => t.name === 'echo')).toBe(true);
    expect(tools.some((t) => t.name === 'add')).toBe(true);
  });

  it('should create a server with sample resources', () => {
    const server = createSampleMockServer();

    const resources = server.getResources();
    expect(resources.length).toBeGreaterThan(0);
    expect(resources.some((r) => r.uri === 'file:///test.txt')).toBe(true);
  });

  it('should create a server with sample prompts', () => {
    const server = createSampleMockServer();

    const prompts = server.getPrompts();
    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts.some((p) => p.name === 'greeting')).toBe(true);
  });

  it('should use custom name', () => {
    const server = createSampleMockServer('custom-server');
    expect(server.name).toBe('custom-server');
  });
});

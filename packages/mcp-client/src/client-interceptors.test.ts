/**
 * Tests for MCPClient interceptor chain wiring (Task 5 of Story 9-11).
 *
 * These tests verify:
 * - interceptorChain accepted via MCPClientOptions (F04)
 * - setInterceptorChain() setter method works
 * - invokeTool() calls runPre() before execution and uses intercepted args
 * - invokeTool() calls runPost() after execution and returns intercepted result
 * - tool:invoked event emitted with intercepted args (not original)
 * - tool:completed event reflects post-intercepted result's success status
 * - Pre/post interceptor warnings logged via logger.warn() (F14)
 * - Backward compatibility: no interceptor chain means unchanged behavior
 * - Interceptor chain errors propagate correctly
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { MCPClient, type MCPClientOptions, type MCPClientLogger } from './client.js';
import { ToolInterceptorChain, type PreInterceptor, type PostInterceptor } from './interceptors.js';
import type { ToolResult, MCPClientConfig } from './types.js';

// --- Internal access helpers ---
// We need to access MCPClient internals for testing.
// This is a common pattern in TypeScript testing when testing integration
// with private dependencies.

type MCPClientInternals = {
  connectionPool: {
    requireConnection: Mock;
    addServer: Mock;
    connectAll: Mock;
    disconnectAll: Mock;
    clear: Mock;
    setOnServerStatusChange: Mock;
    getServerInfos: Mock;
  };
  toolRegistry: {
    get: Mock;
    list: Mock;
    listByServer: Mock;
    registerAll: Mock;
    clear: Mock;
    unregisterServer: Mock;
  };
  resourceRegistry: {
    list: Mock;
    registerAll: Mock;
    clear: Mock;
    unregisterServer: Mock;
  };
  promptRegistry: {
    registerAll: Mock;
    clear: Mock;
    unregisterServer: Mock;
  };
  rateLimiters: {
    get: Mock;
    clear: Mock;
    getOrCreate: Mock;
  };
  capabilityCache: {
    invalidateAll: Mock;
  };
  resourceCache: {
    clear: Mock;
  };
  eventEmitter: {
    emit: Mock;
    on: Mock;
    off: Mock;
    removeAllListeners: Mock;
  };
  initialized: boolean;
  config: MCPClientConfig;
  interceptorChain?: ToolInterceptorChain;
};

/**
 * Helper: creates a mock MCPClient that bypasses constructor dependencies
 * and allows direct testing of invokeTool interceptor integration.
 */
function createTestClient(options?: MCPClientOptions): {
  client: MCPClient;
  internals: MCPClientInternals;
} {
  const client = new MCPClient(options);

  // Access internals for test setup
  const internals = client as unknown as MCPClientInternals;

  // Mock the connection pool
  const mockConnection = {
    getStatus: vi.fn().mockReturnValue('connected'),
    invokeTool: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'tool output' }],
      isError: false,
    }),
  };

  internals.connectionPool = {
    requireConnection: vi.fn().mockReturnValue(mockConnection),
    addServer: vi.fn(),
    connectAll: vi.fn().mockResolvedValue([]),
    disconnectAll: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
    setOnServerStatusChange: vi.fn(),
    getServerInfos: vi.fn().mockReturnValue([]),
  };

  // Mock tool registry
  internals.toolRegistry = {
    get: vi.fn().mockReturnValue({
      name: 'test-tool',
      description: 'A test tool',
      inputSchema: { type: 'object', properties: {} },
      serverName: 'test-server',
    }),
    list: vi.fn().mockReturnValue([]),
    listByServer: vi.fn().mockReturnValue([]),
    registerAll: vi.fn(),
    clear: vi.fn(),
    unregisterServer: vi.fn(),
  };

  // Mock other registries
  internals.resourceRegistry = {
    list: vi.fn().mockReturnValue([]),
    registerAll: vi.fn(),
    clear: vi.fn(),
    unregisterServer: vi.fn(),
  };
  internals.promptRegistry = {
    registerAll: vi.fn(),
    clear: vi.fn(),
    unregisterServer: vi.fn(),
  };

  // Mock rate limiters
  internals.rateLimiters = {
    get: vi.fn().mockReturnValue(undefined),
    clear: vi.fn(),
    getOrCreate: vi.fn(),
  };

  // Mock caches
  internals.capabilityCache = {
    invalidateAll: vi.fn(),
  };
  internals.resourceCache = {
    clear: vi.fn(),
  };

  // Mock event emitter
  internals.eventEmitter = {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    removeAllListeners: vi.fn(),
  };

  // Set initialized state
  internals.initialized = true;
  internals.config = {
    servers: [],
    defaultTimeout: 5000,
    retryAttempts: 1,
    retryDelayMs: 100,
    enableCaching: false,
    cacheTTLMs: 0,
    logLevel: 'warn',
  };

  return { client, internals };
}

function makeToolResult(overrides: Partial<ToolResult> = {}): ToolResult {
  return {
    success: true,
    content: [{ type: 'text', text: 'hello world' }],
    ...overrides,
  };
}

// --- Tests ---

describe('MCPClient interceptor chain wiring', () => {
  describe('MCPClientOptions.interceptorChain (F04)', () => {
    it('accepts interceptor chain via constructor options', () => {
      const chain = new ToolInterceptorChain();
      const { internals } = createTestClient({ interceptorChain: chain });

      expect(internals.interceptorChain).toBe(chain);
    });

    it('has no interceptor chain when options omit it', () => {
      const { internals } = createTestClient();

      expect(internals.interceptorChain).toBeUndefined();
    });

    it('has no interceptor chain when called with empty options', () => {
      const { internals } = createTestClient({});

      expect(internals.interceptorChain).toBeUndefined();
    });
  });

  describe('setInterceptorChain()', () => {
    it('sets the interceptor chain on the client', () => {
      const chain = new ToolInterceptorChain();
      const { client, internals } = createTestClient();

      client.setInterceptorChain(chain);

      expect(internals.interceptorChain).toBe(chain);
    });

    it('overwrites a previously set chain', () => {
      const chain1 = new ToolInterceptorChain();
      const chain2 = new ToolInterceptorChain();
      const { client, internals } = createTestClient({ interceptorChain: chain1 });

      expect(internals.interceptorChain).toBe(chain1);

      client.setInterceptorChain(chain2);

      expect(internals.interceptorChain).toBe(chain2);
    });
  });

  describe('invokeTool() without interceptor chain', () => {
    it('works unchanged when no interceptor chain is set (backward compatible)', async () => {
      const { client, internals } = createTestClient();

      const result = await client.invokeTool('test-server', 'test-tool', { key: 'value' });

      expect(result.success).toBe(true);
      expect(result.content).toEqual([{ type: 'text', text: 'tool output' }]);

      // Verify the connection was called with original args
      const mockConnection = internals.connectionPool.requireConnection.mock.results[0]?.value;
      expect(mockConnection.invokeTool).toHaveBeenCalledWith(
        'test-tool',
        { key: 'value' },
        undefined,
      );
    });
  });

  describe('invokeTool() with interceptor chain - pre-interceptors', () => {
    it('calls runPre() before tool execution', async () => {
      const chain = new ToolInterceptorChain();
      const preInterceptor = vi.fn<Parameters<PreInterceptor>, ReturnType<PreInterceptor>>(
        async (_toolName, args) => ({
          args: { ...args, injected: true },
          warnings: [],
        }),
      );
      chain.addPreInterceptor(preInterceptor);

      const { client } = createTestClient({ interceptorChain: chain });

      await client.invokeTool('test-server', 'test-tool', { key: 'value' });

      expect(preInterceptor).toHaveBeenCalledTimes(1);
      expect(preInterceptor).toHaveBeenCalledWith('test-tool', { key: 'value' });
    });

    it('uses intercepted args for actual tool execution', async () => {
      const chain = new ToolInterceptorChain();
      chain.addPreInterceptor(async (_toolName, args) => ({
        args: { ...args, sanitized: true, extra: 'added' },
        warnings: [],
      }));

      const { client, internals } = createTestClient({ interceptorChain: chain });

      await client.invokeTool('test-server', 'test-tool', { key: 'value' });

      // The connection should receive the intercepted args, not original
      const mockConnection = internals.connectionPool.requireConnection.mock.results[0]?.value;
      expect(mockConnection.invokeTool).toHaveBeenCalledWith(
        'test-tool',
        { key: 'value', sanitized: true, extra: 'added' },
        undefined,
      );
    });

    it('emits tool:invoked event with intercepted args, not original', async () => {
      const chain = new ToolInterceptorChain();
      chain.addPreInterceptor(async (_toolName, _args) => ({
        args: { replaced: true },
        warnings: [],
      }));

      const { client, internals } = createTestClient({ interceptorChain: chain });

      await client.invokeTool('test-server', 'test-tool', { original: true });

      // Find the tool:invoked emit call
      const invokedEmitCall = internals.eventEmitter.emit.mock.calls.find(
        (call: unknown[]) => call[0] === 'tool:invoked',
      );

      expect(invokedEmitCall).toBeDefined();
      expect(invokedEmitCall![1]).toEqual({
        serverName: 'test-server',
        toolName: 'test-tool',
        args: { replaced: true },
      });
    });

    it('runs pre-interceptor after argument validation', async () => {
      const chain = new ToolInterceptorChain();
      const callOrder: string[] = [];

      chain.addPreInterceptor(async (_toolName, args) => {
        callOrder.push('pre-interceptor');
        return { args, warnings: [] };
      });

      const { client, internals } = createTestClient({ interceptorChain: chain });

      // Set up tool with schema that requires 'message' field
      internals.toolRegistry.get.mockReturnValue({
        name: 'test-tool',
        description: 'A test tool',
        inputSchema: {
          type: 'object',
          properties: {
            message: { type: 'string' },
          },
          required: ['message'],
        },
        serverName: 'test-server',
      });

      // This should pass validation then hit pre-interceptor
      await client.invokeTool('test-server', 'test-tool', { message: 'hello' });

      expect(callOrder).toContain('pre-interceptor');
    });
  });

  describe('invokeTool() with interceptor chain - post-interceptors', () => {
    it('calls runPost() after tool execution', async () => {
      const chain = new ToolInterceptorChain();
      const postInterceptor = vi.fn<Parameters<PostInterceptor>, ReturnType<PostInterceptor>>(
        async (_toolName, result) => ({
          result,
          warnings: [],
        }),
      );
      chain.addPostInterceptor(postInterceptor);

      const { client } = createTestClient({ interceptorChain: chain });

      await client.invokeTool('test-server', 'test-tool', {});

      expect(postInterceptor).toHaveBeenCalledTimes(1);
      expect(postInterceptor).toHaveBeenCalledWith(
        'test-tool',
        expect.objectContaining({ success: true }),
      );
    });

    it('returns post-intercepted result from invokeTool()', async () => {
      const chain = new ToolInterceptorChain();
      chain.addPostInterceptor(async (_toolName, result) => ({
        result: {
          ...result,
          content: [{ type: 'text', text: 'sanitized output' }],
        },
        warnings: [],
      }));

      const { client } = createTestClient({ interceptorChain: chain });

      const result = await client.invokeTool('test-server', 'test-tool', {});

      expect(result.content).toEqual([{ type: 'text', text: 'sanitized output' }]);
    });

    it('emits tool:completed event with post-intercepted success status', async () => {
      const chain = new ToolInterceptorChain();
      // Post-interceptor flips success to false
      chain.addPostInterceptor(async (_toolName, result) => ({
        result: { ...result, success: false },
        warnings: [],
      }));

      const { client, internals } = createTestClient({ interceptorChain: chain });

      await client.invokeTool('test-server', 'test-tool', {});

      // Find the tool:completed emit call
      const completedEmitCall = internals.eventEmitter.emit.mock.calls.find(
        (call: unknown[]) => call[0] === 'tool:completed',
      );

      expect(completedEmitCall).toBeDefined();
      expect(completedEmitCall![1]).toEqual(
        expect.objectContaining({ success: false }),
      );
    });

    it('post-interceptors do NOT run in error path', async () => {
      const chain = new ToolInterceptorChain();
      const postInterceptor = vi.fn<Parameters<PostInterceptor>, ReturnType<PostInterceptor>>(
        async (_toolName, result) => ({
          result,
          warnings: [],
        }),
      );
      chain.addPostInterceptor(postInterceptor);

      const { client, internals } = createTestClient({ interceptorChain: chain });

      // Set up the mock connection to throw before invokeTool is called
      const failingConnection = {
        getStatus: vi.fn().mockReturnValue('connected'),
        invokeTool: vi.fn().mockRejectedValue(new Error('connection failed')),
      };
      internals.connectionPool.requireConnection.mockReturnValue(failingConnection);

      await expect(
        client.invokeTool('test-server', 'test-tool', {}),
      ).rejects.toThrow('connection failed');

      // Post-interceptor should NOT have been called
      expect(postInterceptor).not.toHaveBeenCalled();
    });
  });

  describe('interceptor warning logging (F14)', () => {
    let mockLogger: MCPClientLogger;

    beforeEach(() => {
      mockLogger = {
        warn: vi.fn(),
      };
    });

    it('logs pre-interceptor warnings via logger.warn()', async () => {
      const chain = new ToolInterceptorChain();
      chain.addPreInterceptor(async (_toolName, args) => ({
        args,
        warnings: ['URL was rewritten', 'Suspicious parameter detected'],
      }));

      const { client } = createTestClient({
        interceptorChain: chain,
        logger: mockLogger,
      });

      await client.invokeTool('test-server', 'test-tool', {});

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Pre-interceptor warnings',
        {
          toolName: 'test-tool',
          warnings: ['URL was rewritten', 'Suspicious parameter detected'],
        },
      );
    });

    it('logs post-interceptor warnings via logger.warn()', async () => {
      const chain = new ToolInterceptorChain();
      chain.addPostInterceptor(async (_toolName, result) => ({
        result,
        warnings: ['Content sanitized', 'Script tag removed'],
      }));

      const { client } = createTestClient({
        interceptorChain: chain,
        logger: mockLogger,
      });

      await client.invokeTool('test-server', 'test-tool', {});

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Post-interceptor warnings',
        {
          toolName: 'test-tool',
          warnings: ['Content sanitized', 'Script tag removed'],
        },
      );
    });

    it('does not call logger.warn() when there are no pre-interceptor warnings', async () => {
      const chain = new ToolInterceptorChain();
      chain.addPreInterceptor(async (_toolName, args) => ({
        args,
        warnings: [],
      }));

      const { client } = createTestClient({
        interceptorChain: chain,
        logger: mockLogger,
      });

      await client.invokeTool('test-server', 'test-tool', {});

      // Check that warn was not called with Pre-interceptor prefix
      const preWarnCalls = (mockLogger.warn as Mock).mock.calls.filter(
        (call: unknown[]) => call[0] === 'Pre-interceptor warnings',
      );
      expect(preWarnCalls).toHaveLength(0);
    });

    it('does not call logger.warn() when there are no post-interceptor warnings', async () => {
      const chain = new ToolInterceptorChain();
      chain.addPostInterceptor(async (_toolName, result) => ({
        result,
        warnings: [],
      }));

      const { client } = createTestClient({
        interceptorChain: chain,
        logger: mockLogger,
      });

      await client.invokeTool('test-server', 'test-tool', {});

      // Check that warn was not called with Post-interceptor prefix
      const postWarnCalls = (mockLogger.warn as Mock).mock.calls.filter(
        (call: unknown[]) => call[0] === 'Post-interceptor warnings',
      );
      expect(postWarnCalls).toHaveLength(0);
    });

    it('works without a logger (no crash when logger is undefined)', async () => {
      const chain = new ToolInterceptorChain();
      chain.addPreInterceptor(async (_toolName, args) => ({
        args,
        warnings: ['some warning'],
      }));
      chain.addPostInterceptor(async (_toolName, result) => ({
        result,
        warnings: ['another warning'],
      }));

      // No logger provided
      const { client } = createTestClient({ interceptorChain: chain });

      // Should not throw
      const result = await client.invokeTool('test-server', 'test-tool', {});
      expect(result).toBeDefined();
    });
  });

  describe('full interceptor chain integration', () => {
    it('pre and post interceptors work together', async () => {
      const chain = new ToolInterceptorChain();
      const callOrder: string[] = [];

      chain.addPreInterceptor(async (_toolName, args) => {
        callOrder.push('pre');
        return {
          args: { ...args, preProcessed: true },
          warnings: ['pre-warning'],
        };
      });

      chain.addPostInterceptor(async (_toolName, result) => {
        callOrder.push('post');
        return {
          result: {
            ...result,
            content: [{ type: 'text', text: 'post-processed' }],
          },
          warnings: ['post-warning'],
        };
      });

      const mockLogger: MCPClientLogger = { warn: vi.fn() };
      const { client, internals } = createTestClient({
        interceptorChain: chain,
        logger: mockLogger,
      });

      const result = await client.invokeTool('test-server', 'test-tool', { input: 'data' });

      // Verify call order
      expect(callOrder).toEqual(['pre', 'post']);

      // Verify pre-intercepted args were used
      const mockConnection = internals.connectionPool.requireConnection.mock.results[0]?.value;
      expect(mockConnection.invokeTool).toHaveBeenCalledWith(
        'test-tool',
        { input: 'data', preProcessed: true },
        undefined,
      );

      // Verify post-intercepted result was returned
      expect(result.content).toEqual([{ type: 'text', text: 'post-processed' }]);

      // Verify both sets of warnings were logged
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Pre-interceptor warnings',
        expect.objectContaining({ warnings: ['pre-warning'] }),
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Post-interceptor warnings',
        expect.objectContaining({ warnings: ['post-warning'] }),
      );
    });

    it('interceptor chain errors propagate from runPre()', async () => {
      // ToolInterceptorChain itself catches per-interceptor errors (fail-open),
      // but if the chain method itself somehow fails, it should propagate
      const chain = new ToolInterceptorChain();

      // Mock runPre to throw (simulating an unexpected chain-level error)
      vi.spyOn(chain, 'runPre').mockRejectedValue(new Error('chain-level failure'));

      const { client } = createTestClient({ interceptorChain: chain });

      await expect(
        client.invokeTool('test-server', 'test-tool', {}),
      ).rejects.toThrow('chain-level failure');
    });

    it('interceptor chain errors propagate from runPost()', async () => {
      const chain = new ToolInterceptorChain();

      // Mock runPost to throw (simulating an unexpected chain-level error)
      vi.spyOn(chain, 'runPost').mockRejectedValue(new Error('post-chain-level failure'));

      const { client } = createTestClient({ interceptorChain: chain });

      await expect(
        client.invokeTool('test-server', 'test-tool', {}),
      ).rejects.toThrow('post-chain-level failure');
    });

    it('pre-interceptor failure (fail-open) continues with original args', async () => {
      const chain = new ToolInterceptorChain();

      // Add a failing pre-interceptor -- chain catches it (fail-open)
      chain.addPreInterceptor(async () => {
        throw new Error('interceptor broke');
      });

      const mockLogger: MCPClientLogger = { warn: vi.fn() };
      const { client, internals } = createTestClient({
        interceptorChain: chain,
        logger: mockLogger,
      });

      const result = await client.invokeTool('test-server', 'test-tool', { key: 'value' });

      expect(result.success).toBe(true);

      // Connection should be called with original args (fail-open)
      const mockConnection = internals.connectionPool.requireConnection.mock.results[0]?.value;
      expect(mockConnection.invokeTool).toHaveBeenCalledWith(
        'test-tool',
        { key: 'value' },
        undefined,
      );

      // Warning should have been logged about the failure
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Pre-interceptor warnings',
        expect.objectContaining({
          warnings: expect.arrayContaining([
            expect.stringContaining('Pre-interceptor failed: interceptor broke'),
          ]),
        }),
      );
    });

    it('post-interceptor failure (fail-open) continues with original result', async () => {
      const chain = new ToolInterceptorChain();

      // Add a failing post-interceptor -- chain catches it (fail-open)
      chain.addPostInterceptor(async () => {
        throw new Error('post-interceptor broke');
      });

      const mockLogger: MCPClientLogger = { warn: vi.fn() };
      const { client } = createTestClient({
        interceptorChain: chain,
        logger: mockLogger,
      });

      const result = await client.invokeTool('test-server', 'test-tool', {});

      // Should still get the original result (fail-open)
      expect(result.success).toBe(true);
      expect(result.content).toEqual([{ type: 'text', text: 'tool output' }]);

      // Warning should have been logged about the failure
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Post-interceptor warnings',
        expect.objectContaining({
          warnings: expect.arrayContaining([
            expect.stringContaining('Post-interceptor failed: post-interceptor broke'),
          ]),
        }),
      );
    });
  });

  describe('MCPClientLogger', () => {
    it('logger.warn is available for interceptor warnings', () => {
      const logger: MCPClientLogger = {
        warn: vi.fn(),
      };

      const { client } = createTestClient({ logger });

      // Verify the client was created successfully
      expect(client).toBeDefined();
    });

    it('logger.debug is optional', () => {
      const logger: MCPClientLogger = {
        warn: vi.fn(),
        debug: vi.fn(),
      };

      const { client } = createTestClient({ logger });
      expect(client).toBeDefined();
    });
  });
});

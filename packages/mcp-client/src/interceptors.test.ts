/**
 * Unit tests for ToolInterceptorChain.
 *
 * Tests cover:
 * - addPreInterceptor() and addPostInterceptor()
 * - Empty chain passthrough (no-op)
 * - Single and multiple pre-interceptor piping
 * - Single and multiple post-interceptor piping
 * - Warning accumulation across interceptors
 * - toolName parameter forwarding
 * - Async interceptor awaiting (blocking, not fire-and-forget)
 * - Error isolation per interceptor with fail-open (F09)
 * - Prototype pollution key stripping (F16)
 */

import { describe, it, expect, vi } from 'vitest';
import type { ToolResult } from './types.js';
import {
  ToolInterceptorChain,
  type PreInterceptor,
  type PostInterceptor,
} from './interceptors.js';

// --- Helper factories ---

function makeToolResult(overrides: Partial<ToolResult> = {}): ToolResult {
  return {
    success: true,
    content: [{ type: 'text', text: 'hello world' }],
    ...overrides,
  };
}

// --- Tests ---

describe('ToolInterceptorChain', () => {
  describe('addPreInterceptor', () => {
    it('adds interceptor to the chain', async () => {
      const chain = new ToolInterceptorChain();
      const interceptor: PreInterceptor = async (_toolName, args) => ({
        args: { ...args, added: true },
        warnings: [],
      });

      chain.addPreInterceptor(interceptor);

      const { args } = await chain.runPre('test-tool', { original: true });
      expect(args).toEqual({ original: true, added: true });
    });
  });

  describe('addPostInterceptor', () => {
    it('adds interceptor to the chain', async () => {
      const chain = new ToolInterceptorChain();
      const interceptor: PostInterceptor = async (_toolName, result) => ({
        result: {
          ...result,
          content: [{ type: 'text', text: 'modified' }],
        },
        warnings: [],
      });

      chain.addPostInterceptor(interceptor);

      const { result } = await chain.runPost('test-tool', makeToolResult());
      expect(result.content).toEqual([{ type: 'text', text: 'modified' }]);
    });
  });

  describe('runPre - empty chain', () => {
    it('returns original args with no warnings', async () => {
      const chain = new ToolInterceptorChain();
      const originalArgs = { key: 'value', num: 42 };

      const { args, warnings } = await chain.runPre('test-tool', originalArgs);

      expect(args).toBe(originalArgs); // Same reference -- no modification
      expect(warnings).toEqual([]);
    });
  });

  describe('runPost - empty chain', () => {
    it('returns original result with no warnings', async () => {
      const chain = new ToolInterceptorChain();
      const originalResult = makeToolResult();

      const { result, warnings } = await chain.runPost('test-tool', originalResult);

      expect(result).toBe(originalResult); // Same reference -- no modification
      expect(warnings).toEqual([]);
    });
  });

  describe('runPre - single interceptor', () => {
    it('modifies args and returns warnings', async () => {
      const chain = new ToolInterceptorChain();
      chain.addPreInterceptor(async (_toolName, args) => ({
        args: { ...args, sanitized: true },
        warnings: ['URL was rewritten'],
      }));

      const { args, warnings } = await chain.runPre('test-tool', { url: 'http://example.com' });

      expect(args).toEqual({ url: 'http://example.com', sanitized: true });
      expect(warnings).toEqual(['URL was rewritten']);
    });
  });

  describe('runPost - single interceptor', () => {
    it('modifies result and returns warnings', async () => {
      const chain = new ToolInterceptorChain();
      chain.addPostInterceptor(async (_toolName, result) => ({
        result: {
          ...result,
          content: [{ type: 'text', text: 'sanitized content' }],
        },
        warnings: ['Content was sanitized'],
      }));

      const { result, warnings } = await chain.runPost('test-tool', makeToolResult());

      expect(result.content).toEqual([{ type: 'text', text: 'sanitized content' }]);
      expect(warnings).toEqual(['Content was sanitized']);
    });
  });

  describe('runPre - multiple interceptors', () => {
    it('runs in registration order, each receiving output of previous', async () => {
      const chain = new ToolInterceptorChain();
      const order: number[] = [];

      chain.addPreInterceptor(async (_toolName, args) => {
        order.push(1);
        return {
          args: { ...args, step1: true },
          warnings: ['warning-1'],
        };
      });

      chain.addPreInterceptor(async (_toolName, args) => {
        order.push(2);
        // Verify it receives output of first interceptor
        expect(args).toHaveProperty('step1', true);
        return {
          args: { ...args, step2: true },
          warnings: ['warning-2'],
        };
      });

      chain.addPreInterceptor(async (_toolName, args) => {
        order.push(3);
        // Verify it receives output of second interceptor
        expect(args).toHaveProperty('step1', true);
        expect(args).toHaveProperty('step2', true);
        return {
          args: { ...args, step3: true },
          warnings: ['warning-3'],
        };
      });

      const { args, warnings } = await chain.runPre('test-tool', { original: true });

      expect(order).toEqual([1, 2, 3]);
      expect(args).toEqual({ original: true, step1: true, step2: true, step3: true });
      expect(warnings).toEqual(['warning-1', 'warning-2', 'warning-3']);
    });
  });

  describe('runPost - multiple interceptors', () => {
    it('runs in registration order, each receiving output of previous', async () => {
      const chain = new ToolInterceptorChain();
      const order: number[] = [];

      chain.addPostInterceptor(async (_toolName, result) => {
        order.push(1);
        return {
          result: {
            ...result,
            content: [{ type: 'text' as const, text: `${(result.content[0] as { type: 'text'; text: string }).text}-step1` }],
          },
          warnings: ['post-warning-1'],
        };
      });

      chain.addPostInterceptor(async (_toolName, result) => {
        order.push(2);
        return {
          result: {
            ...result,
            content: [{ type: 'text' as const, text: `${(result.content[0] as { type: 'text'; text: string }).text}-step2` }],
          },
          warnings: ['post-warning-2'],
        };
      });

      const { result, warnings } = await chain.runPost(
        'test-tool',
        makeToolResult({ content: [{ type: 'text', text: 'original' }] }),
      );

      expect(order).toEqual([1, 2]);
      expect(result.content).toEqual([{ type: 'text', text: 'original-step1-step2' }]);
      expect(warnings).toEqual(['post-warning-1', 'post-warning-2']);
    });
  });

  describe('warning accumulation', () => {
    it('warnings from multiple interceptors are accumulated in a flat array', async () => {
      const chain = new ToolInterceptorChain();

      chain.addPreInterceptor(async (_toolName, args) => ({
        args,
        warnings: ['w1', 'w2'],
      }));

      chain.addPreInterceptor(async (_toolName, args) => ({
        args,
        warnings: ['w3'],
      }));

      const { warnings } = await chain.runPre('test-tool', {});

      expect(warnings).toEqual(['w1', 'w2', 'w3']);
    });
  });

  describe('toolName parameter', () => {
    it('pre-interceptor receives correct toolName', async () => {
      const chain = new ToolInterceptorChain();
      const receivedToolNames: string[] = [];

      chain.addPreInterceptor(async (toolName, args) => {
        receivedToolNames.push(toolName);
        return { args, warnings: [] };
      });

      await chain.runPre('my-special-tool', {});

      expect(receivedToolNames).toEqual(['my-special-tool']);
    });

    it('post-interceptor receives correct toolName', async () => {
      const chain = new ToolInterceptorChain();
      const receivedToolNames: string[] = [];

      chain.addPostInterceptor(async (toolName, result) => {
        receivedToolNames.push(toolName);
        return { result, warnings: [] };
      });

      await chain.runPost('my-special-tool', makeToolResult());

      expect(receivedToolNames).toEqual(['my-special-tool']);
    });
  });

  describe('async awaiting', () => {
    it('runPre awaits async interceptors (not fire-and-forget)', async () => {
      const chain = new ToolInterceptorChain();
      let asyncWorkDone = false;

      chain.addPreInterceptor(async (_toolName, args) => {
        // Simulate async work
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 10);
        });
        asyncWorkDone = true;
        return { args: { ...args, asyncDone: true }, warnings: [] };
      });

      const { args } = await chain.runPre('test-tool', {});

      expect(asyncWorkDone).toBe(true);
      expect(args).toHaveProperty('asyncDone', true);
    });

    it('runPost awaits async interceptors (not fire-and-forget)', async () => {
      const chain = new ToolInterceptorChain();
      let asyncWorkDone = false;

      chain.addPostInterceptor(async (_toolName, result) => {
        // Simulate async work
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 10);
        });
        asyncWorkDone = true;
        return {
          result: { ...result, content: [{ type: 'text', text: 'async-result' }] },
          warnings: [],
        };
      });

      const { result } = await chain.runPost('test-tool', makeToolResult());

      expect(asyncWorkDone).toBe(true);
      expect(result.content).toEqual([{ type: 'text', text: 'async-result' }]);
    });
  });

  describe('error isolation (F09)', () => {
    it('runPre catches interceptor error, adds warning, continues with unmodified args', async () => {
      const chain = new ToolInterceptorChain();

      // First interceptor: modifies args
      chain.addPreInterceptor(async (_toolName, args) => ({
        args: { ...args, step1: true },
        warnings: [],
      }));

      // Second interceptor: throws
      chain.addPreInterceptor(async () => {
        throw new Error('interceptor exploded');
      });

      // Third interceptor: should still run with args from first
      chain.addPreInterceptor(async (_toolName, args) => ({
        args: { ...args, step3: true },
        warnings: [],
      }));

      const { args, warnings } = await chain.runPre('test-tool', { original: true });

      // Args should have step1 (from first) but NOT step2 (second threw)
      // Third interceptor receives the args from step1 (not modified by failed step2)
      expect(args).toEqual({ original: true, step1: true, step3: true });
      expect(warnings).toContain('Pre-interceptor failed: interceptor exploded');
    });

    it('runPre catches non-Error thrown values', async () => {
      const chain = new ToolInterceptorChain();

      chain.addPreInterceptor(async () => {
        throw 'string error'; // eslint-disable-line no-throw-literal
      });

      const { warnings } = await chain.runPre('test-tool', {});

      expect(warnings).toContain('Pre-interceptor failed: string error');
    });

    it('runPost catches interceptor error, adds warning, continues with unmodified result', async () => {
      const chain = new ToolInterceptorChain();
      const originalResult = makeToolResult({
        content: [{ type: 'text', text: 'original' }],
      });

      // First interceptor: modifies result
      chain.addPostInterceptor(async (_toolName, result) => ({
        result: {
          ...result,
          content: [{ type: 'text', text: 'modified' }],
        },
        warnings: [],
      }));

      // Second interceptor: throws
      chain.addPostInterceptor(async () => {
        throw new Error('post-interceptor failed');
      });

      // Third interceptor: should still run with result from first
      chain.addPostInterceptor(async (_toolName, result) => ({
        result: {
          ...result,
          content: [
            ...result.content,
            { type: 'text' as const, text: 'appended' },
          ],
        },
        warnings: [],
      }));

      const { result, warnings } = await chain.runPost('test-tool', originalResult);

      // Result should be from first interceptor (modified), then third appends
      // Second interceptor threw, so third receives the result from first
      expect(result.content).toEqual([
        { type: 'text', text: 'modified' },
        { type: 'text', text: 'appended' },
      ]);
      expect(warnings).toContain('Post-interceptor failed: post-interceptor failed');
    });

    it('runPost catches non-Error thrown values', async () => {
      const chain = new ToolInterceptorChain();

      chain.addPostInterceptor(async () => {
        throw 42; // eslint-disable-line no-throw-literal
      });

      const { warnings } = await chain.runPost('test-tool', makeToolResult());

      expect(warnings).toContain('Post-interceptor failed: 42');
    });

    it('error in one pre-interceptor does not skip subsequent interceptors', async () => {
      const chain = new ToolInterceptorChain();
      const callOrder: string[] = [];

      chain.addPreInterceptor(async (_toolName, args) => {
        callOrder.push('first');
        return { args, warnings: [] };
      });

      chain.addPreInterceptor(async () => {
        callOrder.push('second-throws');
        throw new Error('boom');
      });

      chain.addPreInterceptor(async (_toolName, args) => {
        callOrder.push('third');
        return { args, warnings: [] };
      });

      await chain.runPre('test-tool', {});

      expect(callOrder).toEqual(['first', 'second-throws', 'third']);
    });

    it('error in one post-interceptor does not skip subsequent interceptors', async () => {
      const chain = new ToolInterceptorChain();
      const callOrder: string[] = [];

      chain.addPostInterceptor(async (_toolName, result) => {
        callOrder.push('first');
        return { result, warnings: [] };
      });

      chain.addPostInterceptor(async () => {
        callOrder.push('second-throws');
        throw new Error('boom');
      });

      chain.addPostInterceptor(async (_toolName, result) => {
        callOrder.push('third');
        return { result, warnings: [] };
      });

      await chain.runPost('test-tool', makeToolResult());

      expect(callOrder).toEqual(['first', 'second-throws', 'third']);
    });
  });

  describe('prototype pollution protection (F16)', () => {
    it('runPre strips __proto__ key from returned args', async () => {
      const chain = new ToolInterceptorChain();

      chain.addPreInterceptor(async (_toolName, _args) => {
        // Use Object.create(null) to create a truly clean object, then add __proto__ as own prop
        const maliciousArgs = Object.create(null) as Record<string, unknown>;
        maliciousArgs['safe'] = true;
        maliciousArgs['__proto__'] = { polluted: true };
        return { args: maliciousArgs, warnings: [] };
      });

      const { args, warnings } = await chain.runPre('test-tool', {});

      expect(Object.hasOwn(args, '__proto__')).toBe(false);
      expect(args['safe']).toBe(true);
      expect(warnings).toContain('Prototype pollution key "__proto__" removed from interceptor output');
    });

    it('runPre strips constructor key from returned args', async () => {
      const chain = new ToolInterceptorChain();

      chain.addPreInterceptor(async (_toolName, _args) => ({
        args: { safe: true, constructor: 'malicious' } as Record<string, unknown>,
        warnings: [],
      }));

      const { args, warnings } = await chain.runPre('test-tool', {});

      expect(Object.hasOwn(args, 'constructor')).toBe(false);
      expect(args['safe']).toBe(true);
      expect(warnings).toContain('Prototype pollution key "constructor" removed from interceptor output');
    });

    it('runPre strips prototype key from returned args', async () => {
      const chain = new ToolInterceptorChain();

      chain.addPreInterceptor(async (_toolName, _args) => ({
        args: { safe: true, prototype: {} } as Record<string, unknown>,
        warnings: [],
      }));

      const { args, warnings } = await chain.runPre('test-tool', {});

      expect(Object.hasOwn(args, 'prototype')).toBe(false);
      expect(args['safe']).toBe(true);
      expect(warnings).toContain('Prototype pollution key "prototype" removed from interceptor output');
    });

    it('runPre adds warning when prototype pollution key is stripped', async () => {
      const chain = new ToolInterceptorChain();

      chain.addPreInterceptor(async (_toolName, _args) => ({
        args: {
          safe: 'value',
          constructor: 'bad',
          prototype: 'bad',
        } as Record<string, unknown>,
        warnings: ['interceptor-warning'],
      }));

      const { warnings } = await chain.runPre('test-tool', {});

      // Should have: pollution warnings + interceptor's own warning
      expect(warnings).toContain('Prototype pollution key "constructor" removed from interceptor output');
      expect(warnings).toContain('Prototype pollution key "prototype" removed from interceptor output');
      expect(warnings).toContain('interceptor-warning');
    });

    it('runPre does not strip legitimate keys', async () => {
      const chain = new ToolInterceptorChain();

      chain.addPreInterceptor(async (_toolName, _args) => ({
        args: { name: 'test', url: 'http://example.com', count: 5 },
        warnings: [],
      }));

      const { args, warnings } = await chain.runPre('test-tool', {});

      expect(args).toEqual({ name: 'test', url: 'http://example.com', count: 5 });
      expect(warnings).toEqual([]);
    });

    it('pollution warnings appear before interceptor warnings in accumulated array', async () => {
      const chain = new ToolInterceptorChain();

      chain.addPreInterceptor(async (_toolName, _args) => ({
        args: { constructor: 'bad' } as Record<string, unknown>,
        warnings: ['my-warning'],
      }));

      const { warnings } = await chain.runPre('test-tool', {});

      // Pollution warning is added before interceptor's own warnings
      const pollutionIndex = warnings.indexOf('Prototype pollution key "constructor" removed from interceptor output');
      const ownWarningIndex = warnings.indexOf('my-warning');

      expect(pollutionIndex).toBeGreaterThanOrEqual(0);
      expect(ownWarningIndex).toBeGreaterThanOrEqual(0);
      expect(pollutionIndex).toBeLessThan(ownWarningIndex);
    });
  });

  describe('type safety', () => {
    it('PreInterceptor type signature is correct', () => {
      // Compile-time check: this should typecheck
      const fn: PreInterceptor = async (toolName: string, args: Record<string, unknown>) => ({
        args: { ...args, tool: toolName },
        warnings: [],
      });
      expect(typeof fn).toBe('function');
    });

    it('PostInterceptor type signature is correct', () => {
      // Compile-time check: this should typecheck
      const fn: PostInterceptor = async (toolName: string, result: ToolResult) => ({
        result: { ...result, metadata: { latencyMs: 0, serverName: 's', toolName } },
        warnings: [],
      });
      expect(typeof fn).toBe('function');
    });
  });

  describe('isolation between pre and post chains', () => {
    it('pre and post interceptors operate independently', async () => {
      const chain = new ToolInterceptorChain();
      const preCallCount = vi.fn();
      const postCallCount = vi.fn();

      chain.addPreInterceptor(async (_toolName, args) => {
        preCallCount();
        return { args, warnings: ['pre-warning'] };
      });

      chain.addPostInterceptor(async (_toolName, result) => {
        postCallCount();
        return { result, warnings: ['post-warning'] };
      });

      // Running runPre should not invoke post-interceptors
      const preResult = await chain.runPre('test-tool', {});
      expect(preCallCount).toHaveBeenCalledTimes(1);
      expect(postCallCount).not.toHaveBeenCalled();
      expect(preResult.warnings).toEqual(['pre-warning']);

      // Running runPost should not invoke pre-interceptors
      const postResult = await chain.runPost('test-tool', makeToolResult());
      expect(preCallCount).toHaveBeenCalledTimes(1); // still 1
      expect(postCallCount).toHaveBeenCalledTimes(1);
      expect(postResult.warnings).toEqual(['post-warning']);
    });
  });
});

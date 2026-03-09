/**
 * Unit tests for the bridge wiring pattern that connects
 * MCPClient EventEmitter events to the DiagnosticsQueue.
 *
 * The bridge is NOT a class -- it is a wiring pattern applied at
 * the application level (CLI start.tsx or server.ts). These tests
 * validate the pattern by simulating the wiring with an EventEmitter,
 * a DiagnosticsQueue, and mock utilities.
 *
 * Tests cover:
 * - tool:invoked -> tool:invoke mapping
 * - tool:completed (success: true) -> tool:complete mapping
 * - tool:completed (success: false) -> tool:error mapping
 * - correlationId generation via crypto.randomUUID() and pairing (F15)
 * - Timestamp population with current time
 * - Context fields (agentType, projectId, engineId, taskId, taskType) pass-through
 * - Args truncation via truncateArgs() (F06)
 * - Sensitive key redaction via redactSensitiveKeys() (F07)
 * - errorMessage sanitization via sanitizeErrorMessage() (F07)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { ToolDiagnosticsEvent, DiagnosticsEvent } from './diagnostics-event.js';
import { DiagnosticsQueue } from './diagnostics-queue.js';
import { truncateArgs, redactSensitiveKeys, MAX_DIAGNOSTICS_ARG_SIZE, DEFAULT_SENSITIVE_KEYS } from './utils.js';
import { sanitizeErrorMessage } from './sanitize-error.js';

// --- Types for the bridge wiring pattern ---

interface ToolInvokedData {
  serverName: string;
  toolName: string;
  args: Record<string, unknown>;
}

interface ToolCompletedData {
  serverName: string;
  toolName: string;
  success: boolean;
  latencyMs: number;
  errorMessage?: string;
}

interface BridgeContext {
  agentType: 'implementer' | 'reviewer' | 'tester';
  projectId: string;
  engineId: string;
  taskId: string;
  taskType: string;
}

/**
 * Sets up the bridge wiring pattern as described in the story spec.
 * Returns the emitter (simulating MCPClient), the queue, and the pending correlations map.
 */
function setupBridge(context: BridgeContext) {
  const mcpClient = new EventEmitter();
  const diagnosticsQueue = new DiagnosticsQueue({ drainIntervalMs: 5000 });
  const pendingCorrelations = new Map<string, string>();
  const emittedEvents: DiagnosticsEvent[] = [];

  // Capture all emitted events by wrapping diagnosticsQueue.emit
  const originalEmit = diagnosticsQueue.emit.bind(diagnosticsQueue);
  diagnosticsQueue.emit = (event: DiagnosticsEvent): void => {
    emittedEvents.push(event);
    originalEmit(event);
  };

  // Bridge wiring: tool:invoked -> tool:invoke
  mcpClient.on('tool:invoked', (data: ToolInvokedData) => {
    const correlationId = randomUUID();
    pendingCorrelations.set(`${data.serverName}:${data.toolName}`, correlationId);

    diagnosticsQueue.emit({
      type: 'tool:invoke',
      timestamp: Date.now(),
      correlationId,
      serverName: data.serverName,
      toolName: data.toolName,
      args: truncateArgs(
        redactSensitiveKeys(data.args, DEFAULT_SENSITIVE_KEYS),
        MAX_DIAGNOSTICS_ARG_SIZE,
      ),
      agentType: context.agentType,
      projectId: context.projectId,
      engineId: context.engineId,
      taskId: context.taskId,
      taskType: context.taskType,
    });
  });

  // Bridge wiring: tool:completed -> tool:complete / tool:error
  mcpClient.on('tool:completed', (data: ToolCompletedData) => {
    const key = `${data.serverName}:${data.toolName}`;
    const correlationId = pendingCorrelations.get(key);
    pendingCorrelations.delete(key);

    const event: ToolDiagnosticsEvent = {
      type: data.success ? 'tool:complete' : 'tool:error',
      timestamp: Date.now(),
      toolName: data.toolName,
      serverName: data.serverName,
      latencyMs: data.latencyMs,
      success: data.success,
      agentType: context.agentType,
      projectId: context.projectId,
      engineId: context.engineId,
      taskId: context.taskId,
      taskType: context.taskType,
    };

    if (correlationId !== undefined) {
      event.correlationId = correlationId;
    }

    if (data.errorMessage) {
      event.errorMessage = sanitizeErrorMessage(data.errorMessage);
    }

    diagnosticsQueue.emit(event);
  });

  return { mcpClient, diagnosticsQueue, pendingCorrelations, emittedEvents };
}

// --- Tests ---

describe('Bridge wiring pattern', () => {
  const defaultContext: BridgeContext = {
    agentType: 'implementer',
    projectId: 'proj-test',
    engineId: 'eng-test',
    taskId: 'task-test',
    taskType: 'implementation',
  };

  describe('tool:invoked -> tool:invoke mapping', () => {
    it('maps tool:invoked event to diagnosticsQueue.emit with type: "tool:invoke"', () => {
      const { mcpClient, emittedEvents } = setupBridge(defaultContext);

      mcpClient.emit('tool:invoked', {
        serverName: 'github-server',
        toolName: 'create_pull_request',
        args: { title: 'Fix bug', body: 'Fixes #123' },
      } satisfies ToolInvokedData);

      expect(emittedEvents).toHaveLength(1);
      const event = emittedEvents[0] as ToolDiagnosticsEvent;
      expect(event.type).toBe('tool:invoke');
      expect(event.toolName).toBe('create_pull_request');
      expect(event.serverName).toBe('github-server');
    });

    it('includes args in the tool:invoke event', () => {
      const { mcpClient, emittedEvents } = setupBridge(defaultContext);

      mcpClient.emit('tool:invoked', {
        serverName: 'server-1',
        toolName: 'read_file',
        args: { path: '/src/main.ts' },
      } satisfies ToolInvokedData);

      const event = emittedEvents[0] as ToolDiagnosticsEvent;
      expect(event.args).toEqual({ path: '/src/main.ts' });
    });
  });

  describe('tool:completed -> tool:complete / tool:error mapping', () => {
    it('maps tool:completed with success:true to type: "tool:complete"', () => {
      const { mcpClient, emittedEvents } = setupBridge(defaultContext);

      // First emit invoked to set up correlation
      mcpClient.emit('tool:invoked', {
        serverName: 'server-1',
        toolName: 'list_files',
        args: {},
      } satisfies ToolInvokedData);

      mcpClient.emit('tool:completed', {
        serverName: 'server-1',
        toolName: 'list_files',
        success: true,
        latencyMs: 150,
      } satisfies ToolCompletedData);

      expect(emittedEvents).toHaveLength(2);
      const completeEvent = emittedEvents[1] as ToolDiagnosticsEvent;
      expect(completeEvent.type).toBe('tool:complete');
      expect(completeEvent.success).toBe(true);
      expect(completeEvent.latencyMs).toBe(150);
    });

    it('maps tool:completed with success:false to type: "tool:error"', () => {
      const { mcpClient, emittedEvents } = setupBridge(defaultContext);

      mcpClient.emit('tool:invoked', {
        serverName: 'server-1',
        toolName: 'run_command',
        args: { command: 'test' },
      } satisfies ToolInvokedData);

      mcpClient.emit('tool:completed', {
        serverName: 'server-1',
        toolName: 'run_command',
        success: false,
        latencyMs: 500,
        errorMessage: 'Command failed with exit code 1',
      } satisfies ToolCompletedData);

      expect(emittedEvents).toHaveLength(2);
      const errorEvent = emittedEvents[1] as ToolDiagnosticsEvent;
      expect(errorEvent.type).toBe('tool:error');
      expect(errorEvent.success).toBe(false);
      expect(errorEvent.latencyMs).toBe(500);
    });
  });

  describe('context fields pass-through', () => {
    it('includes all context fields in tool:invoke events', () => {
      const context: BridgeContext = {
        agentType: 'reviewer',
        projectId: 'proj-42',
        engineId: 'eng-99',
        taskId: 'task-7',
        taskType: 'review',
      };
      const { mcpClient, emittedEvents } = setupBridge(context);

      mcpClient.emit('tool:invoked', {
        serverName: 's1',
        toolName: 't1',
        args: {},
      } satisfies ToolInvokedData);

      const event = emittedEvents[0] as ToolDiagnosticsEvent;
      expect(event.agentType).toBe('reviewer');
      expect(event.projectId).toBe('proj-42');
      expect(event.engineId).toBe('eng-99');
      expect(event.taskId).toBe('task-7');
      expect(event.taskType).toBe('review');
    });

    it('includes all context fields in tool:completed events', () => {
      const context: BridgeContext = {
        agentType: 'tester',
        projectId: 'proj-tdd',
        engineId: 'eng-tdd',
        taskId: 'task-test',
        taskType: 'testing',
      };
      const { mcpClient, emittedEvents } = setupBridge(context);

      mcpClient.emit('tool:invoked', {
        serverName: 's1',
        toolName: 't1',
        args: {},
      } satisfies ToolInvokedData);

      mcpClient.emit('tool:completed', {
        serverName: 's1',
        toolName: 't1',
        success: true,
        latencyMs: 50,
      } satisfies ToolCompletedData);

      const event = emittedEvents[1] as ToolDiagnosticsEvent;
      expect(event.agentType).toBe('tester');
      expect(event.projectId).toBe('proj-tdd');
      expect(event.engineId).toBe('eng-tdd');
      expect(event.taskId).toBe('task-test');
      expect(event.taskType).toBe('testing');
    });
  });

  describe('timestamp', () => {
    it('populates timestamp with current time for tool:invoke', () => {
      const { mcpClient, emittedEvents } = setupBridge(defaultContext);
      const before = Date.now();

      mcpClient.emit('tool:invoked', {
        serverName: 's1',
        toolName: 't1',
        args: {},
      } satisfies ToolInvokedData);

      const after = Date.now();
      const event = emittedEvents[0]!;
      expect(event.timestamp).toBeGreaterThanOrEqual(before);
      expect(event.timestamp).toBeLessThanOrEqual(after);
    });

    it('populates timestamp with current time for tool:completed', () => {
      const { mcpClient, emittedEvents } = setupBridge(defaultContext);

      mcpClient.emit('tool:invoked', {
        serverName: 's1',
        toolName: 't1',
        args: {},
      } satisfies ToolInvokedData);

      const before = Date.now();
      mcpClient.emit('tool:completed', {
        serverName: 's1',
        toolName: 't1',
        success: true,
        latencyMs: 10,
      } satisfies ToolCompletedData);
      const after = Date.now();

      const event = emittedEvents[1]!;
      expect(event.timestamp).toBeGreaterThanOrEqual(before);
      expect(event.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('correlationId pairing (F15)', () => {
    it('generates correlationId via crypto.randomUUID() for tool:invoke', () => {
      const { mcpClient, emittedEvents } = setupBridge(defaultContext);

      mcpClient.emit('tool:invoked', {
        serverName: 'server-a',
        toolName: 'tool-x',
        args: {},
      } satisfies ToolInvokedData);

      const event = emittedEvents[0] as ToolDiagnosticsEvent;
      expect(event.correlationId).toBeDefined();
      // UUID v4 format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
      expect(event.correlationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it('includes the same correlationId in both start and end events', () => {
      const { mcpClient, emittedEvents } = setupBridge(defaultContext);

      mcpClient.emit('tool:invoked', {
        serverName: 'server-a',
        toolName: 'tool-x',
        args: {},
      } satisfies ToolInvokedData);

      mcpClient.emit('tool:completed', {
        serverName: 'server-a',
        toolName: 'tool-x',
        success: true,
        latencyMs: 100,
      } satisfies ToolCompletedData);

      const invokeEvent = emittedEvents[0] as ToolDiagnosticsEvent;
      const completeEvent = emittedEvents[1] as ToolDiagnosticsEvent;

      expect(invokeEvent.correlationId).toBeDefined();
      expect(completeEvent.correlationId).toBeDefined();
      expect(invokeEvent.correlationId).toBe(completeEvent.correlationId);
    });

    it('generates unique correlationIds for different tool calls', () => {
      const { mcpClient, emittedEvents } = setupBridge(defaultContext);

      mcpClient.emit('tool:invoked', {
        serverName: 'server-a',
        toolName: 'tool-1',
        args: {},
      } satisfies ToolInvokedData);

      mcpClient.emit('tool:completed', {
        serverName: 'server-a',
        toolName: 'tool-1',
        success: true,
        latencyMs: 50,
      } satisfies ToolCompletedData);

      mcpClient.emit('tool:invoked', {
        serverName: 'server-a',
        toolName: 'tool-2',
        args: {},
      } satisfies ToolInvokedData);

      const firstInvoke = emittedEvents[0] as ToolDiagnosticsEvent;
      const secondInvoke = emittedEvents[2] as ToolDiagnosticsEvent;

      expect(firstInvoke.correlationId).not.toBe(secondInvoke.correlationId);
    });

    it('cleans up correlationId from pending map after tool:completed', () => {
      const { mcpClient, pendingCorrelations } = setupBridge(defaultContext);

      mcpClient.emit('tool:invoked', {
        serverName: 'server-a',
        toolName: 'tool-x',
        args: {},
      } satisfies ToolInvokedData);

      expect(pendingCorrelations.size).toBe(1);

      mcpClient.emit('tool:completed', {
        serverName: 'server-a',
        toolName: 'tool-x',
        success: true,
        latencyMs: 10,
      } satisfies ToolCompletedData);

      expect(pendingCorrelations.size).toBe(0);
    });

    it('handles tool:completed without prior tool:invoked (no correlationId)', () => {
      const { mcpClient, emittedEvents } = setupBridge(defaultContext);

      // Emit completed without invoked first (edge case)
      mcpClient.emit('tool:completed', {
        serverName: 'server-a',
        toolName: 'orphan-tool',
        success: true,
        latencyMs: 100,
      } satisfies ToolCompletedData);

      expect(emittedEvents).toHaveLength(1);
      const event = emittedEvents[0] as ToolDiagnosticsEvent;
      // correlationId should be undefined since there was no invoked event
      expect(event.correlationId).toBeUndefined();
    });
  });

  describe('args truncation via truncateArgs() (F06)', () => {
    it('truncates large args before queueing', () => {
      const { mcpClient, emittedEvents } = setupBridge(defaultContext);

      const largeArgs = { data: 'x'.repeat(20_000) };

      mcpClient.emit('tool:invoked', {
        serverName: 'server-1',
        toolName: 'tool-1',
        args: largeArgs,
      } satisfies ToolInvokedData);

      const event = emittedEvents[0] as ToolDiagnosticsEvent;
      expect(event.args).toBeDefined();
      // Should be the truncation marker, not the original large args
      expect(event.args!['_truncated']).toBe(true);
      expect(event.args!['_originalSize']).toBeGreaterThan(MAX_DIAGNOSTICS_ARG_SIZE);
    });

    it('does not truncate small args', () => {
      const { mcpClient, emittedEvents } = setupBridge(defaultContext);

      const smallArgs = { key: 'value', count: 42 };

      mcpClient.emit('tool:invoked', {
        serverName: 'server-1',
        toolName: 'tool-1',
        args: smallArgs,
      } satisfies ToolInvokedData);

      const event = emittedEvents[0] as ToolDiagnosticsEvent;
      // Args should match (redacted but since no sensitive keys, same values)
      expect(event.args).toEqual(smallArgs);
    });
  });

  describe('sensitive key redaction (F07)', () => {
    it('redacts sensitive keys from args before queueing', () => {
      const { mcpClient, emittedEvents } = setupBridge(defaultContext);

      mcpClient.emit('tool:invoked', {
        serverName: 'server-1',
        toolName: 'tool-1',
        args: {
          url: 'https://api.example.com',
          token: 'sk-12345abcdef',
          password: 'super-secret',
          apiKey: 'key-abc123',
          secret: 'my-secret',
          authorization: 'Bearer eyJhbGci...',
          normalParam: 'safe-value',
        },
      } satisfies ToolInvokedData);

      const event = emittedEvents[0] as ToolDiagnosticsEvent;
      expect(event.args!['url']).toBe('https://api.example.com');
      expect(event.args!['token']).toBe('[REDACTED]');
      expect(event.args!['password']).toBe('[REDACTED]');
      expect(event.args!['apiKey']).toBe('[REDACTED]');
      expect(event.args!['secret']).toBe('[REDACTED]');
      expect(event.args!['authorization']).toBe('[REDACTED]');
      expect(event.args!['normalParam']).toBe('safe-value');
    });

    it('does not modify the original args object', () => {
      const { mcpClient } = setupBridge(defaultContext);

      const originalArgs = {
        token: 'my-token',
        name: 'test',
      };
      const argsCopy = { ...originalArgs };

      mcpClient.emit('tool:invoked', {
        serverName: 'server-1',
        toolName: 'tool-1',
        args: originalArgs,
      } satisfies ToolInvokedData);

      // Original should be unchanged
      expect(originalArgs).toEqual(argsCopy);
    });
  });

  describe('errorMessage sanitization (F07)', () => {
    it('sanitizes errorMessage via sanitizeErrorMessage() before storing', () => {
      const { mcpClient, emittedEvents } = setupBridge(defaultContext);

      mcpClient.emit('tool:invoked', {
        serverName: 'server-1',
        toolName: 'tool-1',
        args: {},
      } satisfies ToolInvokedData);

      mcpClient.emit('tool:completed', {
        serverName: 'server-1',
        toolName: 'tool-1',
        success: false,
        latencyMs: 500,
        errorMessage: 'Auth failed with Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkw',
      } satisfies ToolCompletedData);

      const event = emittedEvents[1] as ToolDiagnosticsEvent;
      expect(event.errorMessage).toBeDefined();
      // Bearer token should be redacted
      expect(event.errorMessage).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
      expect(event.errorMessage).toContain('[REDACTED]');
    });

    it('does not set errorMessage when no error is present', () => {
      const { mcpClient, emittedEvents } = setupBridge(defaultContext);

      mcpClient.emit('tool:invoked', {
        serverName: 'server-1',
        toolName: 'tool-1',
        args: {},
      } satisfies ToolInvokedData);

      mcpClient.emit('tool:completed', {
        serverName: 'server-1',
        toolName: 'tool-1',
        success: true,
        latencyMs: 100,
      } satisfies ToolCompletedData);

      const event = emittedEvents[1] as ToolDiagnosticsEvent;
      expect(event.errorMessage).toBeUndefined();
    });

    it('sanitizes errorMessage containing API keys', () => {
      const { mcpClient, emittedEvents } = setupBridge(defaultContext);

      mcpClient.emit('tool:invoked', {
        serverName: 'server-1',
        toolName: 'tool-1',
        args: {},
      } satisfies ToolInvokedData);

      mcpClient.emit('tool:completed', {
        serverName: 'server-1',
        toolName: 'tool-1',
        success: false,
        latencyMs: 100,
        errorMessage: 'Request failed with key sk-abc1234567890abcdefghij',
      } satisfies ToolCompletedData);

      const event = emittedEvents[1] as ToolDiagnosticsEvent;
      expect(event.errorMessage).not.toContain('sk-abc1234567890abcdefghij');
      expect(event.errorMessage).toContain('[REDACTED]');
    });
  });

  describe('end-to-end wiring scenario', () => {
    it('full invoke -> complete cycle with all fields', () => {
      const { mcpClient, emittedEvents } = setupBridge({
        agentType: 'implementer',
        projectId: 'proj-e2e',
        engineId: 'eng-e2e',
        taskId: 'task-e2e',
        taskType: 'implementation',
      });

      // Tool invocation
      mcpClient.emit('tool:invoked', {
        serverName: 'github',
        toolName: 'create_pr',
        args: { title: 'Fix #42', body: 'Description', token: 'ghp_secret123' },
      } satisfies ToolInvokedData);

      // Tool completion
      mcpClient.emit('tool:completed', {
        serverName: 'github',
        toolName: 'create_pr',
        success: true,
        latencyMs: 2500,
      } satisfies ToolCompletedData);

      expect(emittedEvents).toHaveLength(2);

      const invokeEvent = emittedEvents[0] as ToolDiagnosticsEvent;
      const completeEvent = emittedEvents[1] as ToolDiagnosticsEvent;

      // Verify invoke event
      expect(invokeEvent.type).toBe('tool:invoke');
      expect(invokeEvent.toolName).toBe('create_pr');
      expect(invokeEvent.serverName).toBe('github');
      expect(invokeEvent.args!['title']).toBe('Fix #42');
      expect(invokeEvent.args!['body']).toBe('Description');
      expect(invokeEvent.args!['token']).toBe('[REDACTED]');
      expect(invokeEvent.agentType).toBe('implementer');
      expect(invokeEvent.projectId).toBe('proj-e2e');
      expect(invokeEvent.correlationId).toBeDefined();

      // Verify complete event
      expect(completeEvent.type).toBe('tool:complete');
      expect(completeEvent.toolName).toBe('create_pr');
      expect(completeEvent.success).toBe(true);
      expect(completeEvent.latencyMs).toBe(2500);
      expect(completeEvent.correlationId).toBe(invokeEvent.correlationId);
      expect(completeEvent.errorMessage).toBeUndefined();
    });

    it('full invoke -> error cycle with sanitized error message', () => {
      const { mcpClient, emittedEvents } = setupBridge(defaultContext);

      mcpClient.emit('tool:invoked', {
        serverName: 'db-server',
        toolName: 'run_query',
        args: { query: 'SELECT * FROM users', password: 'dbpass123' },
      } satisfies ToolInvokedData);

      mcpClient.emit('tool:completed', {
        serverName: 'db-server',
        toolName: 'run_query',
        success: false,
        latencyMs: 30000,
        errorMessage: 'Connection timeout after 30s',
      } satisfies ToolCompletedData);

      expect(emittedEvents).toHaveLength(2);

      const invokeEvent = emittedEvents[0] as ToolDiagnosticsEvent;
      const errorEvent = emittedEvents[1] as ToolDiagnosticsEvent;

      // Verify invoke event has redacted password
      expect(invokeEvent.args!['password']).toBe('[REDACTED]');
      expect(invokeEvent.args!['query']).toBe('SELECT * FROM users');

      // Verify error event
      expect(errorEvent.type).toBe('tool:error');
      expect(errorEvent.success).toBe(false);
      expect(errorEvent.errorMessage).toBe('Connection timeout after 30s');
      expect(errorEvent.correlationId).toBe(invokeEvent.correlationId);
    });
  });
});

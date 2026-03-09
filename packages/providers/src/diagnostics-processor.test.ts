/**
 * Unit tests for createDiagnosticsProcessor (providers layer).
 *
 * Tests cover:
 * - Mapping provider:complete events to correct UsageRecordInput
 * - Mapping provider:error events correctly
 * - Mapping tool:complete events correctly
 * - Mapping tool:error events correctly
 * - Calling costTracker.recordUsage() for each mappable event
 * - Ignoring provider:call events
 * - Ignoring tool:invoke events
 * - Handling batch with mixed event types
 * - Handling empty batch
 * - Provider field uses mapProviderName()
 * - Unknown provider name defaults to 'claude-code'
 * - Context fields come from event directly
 * - Tokens default to 0 when missing
 * - totalTokens = input + output
 * - Token counts validated via validateTokenCount()
 * - errorCode validated via validateErrorCode()
 * - Single recordUsage() failure doesn't prevent remaining events
 * - Errors logged via logger?.warn()
 * - Processor works without logger
 * - Model defaults to 'unknown'
 * - Processor function signature matches DiagnosticsEventProcessor type
 */

import { describe, it, expect, vi } from 'vitest';
import type {
  ToolDiagnosticsEvent,
  ProviderDiagnosticsEvent,
  DiagnosticsEvent,
  DiagnosticsEventProcessor,
} from '@tamma/shared/telemetry';
import type { ILogger } from '@tamma/shared';
import type { ICostTracker, UsageRecordInput } from '@tamma/cost-monitor';
import { MAX_TOKEN_COUNT, MAX_ERROR_CODE_LENGTH } from '@tamma/shared/telemetry';
import { createDiagnosticsProcessor } from './diagnostics-processor.js';

// --- Helper factories ---

function makeProviderCompleteEvent(
  overrides: Partial<ProviderDiagnosticsEvent> = {},
): ProviderDiagnosticsEvent {
  return {
    type: 'provider:complete',
    timestamp: Date.now(),
    providerName: 'anthropic',
    model: 'claude-sonnet-4',
    tokens: { input: 1000, output: 500 },
    latencyMs: 2000,
    success: true,
    projectId: 'proj-1',
    engineId: 'eng-1',
    agentType: 'implementer',
    taskId: 'task-1',
    taskType: 'implementation',
    ...overrides,
  };
}

function makeProviderErrorEvent(
  overrides: Partial<ProviderDiagnosticsEvent> = {},
): ProviderDiagnosticsEvent {
  return {
    type: 'provider:error',
    timestamp: Date.now(),
    providerName: 'openai',
    model: 'gpt-4o',
    latencyMs: 100,
    success: false,
    errorCode: 'RATE_LIMIT_EXCEEDED',
    errorMessage: 'Rate limit hit',
    projectId: 'proj-1',
    engineId: 'eng-1',
    agentType: 'reviewer',
    taskId: 'task-2',
    taskType: 'review',
    ...overrides,
  };
}

function makeToolCompleteEvent(
  overrides: Partial<ToolDiagnosticsEvent> = {},
): ToolDiagnosticsEvent {
  return {
    type: 'tool:complete',
    timestamp: Date.now(),
    toolName: 'test-tool',
    latencyMs: 150,
    success: true,
    projectId: 'proj-1',
    engineId: 'eng-1',
    agentType: 'implementer',
    taskId: 'task-1',
    taskType: 'implementation',
    ...overrides,
  };
}

function makeToolErrorEvent(
  overrides: Partial<ToolDiagnosticsEvent> = {},
): ToolDiagnosticsEvent {
  return {
    type: 'tool:error',
    timestamp: Date.now(),
    toolName: 'test-tool',
    latencyMs: 500,
    success: false,
    errorCode: 'TIMEOUT',
    errorMessage: 'Tool timed out',
    projectId: 'proj-1',
    engineId: 'eng-1',
    agentType: 'implementer',
    taskId: 'task-1',
    taskType: 'implementation',
    ...overrides,
  };
}

function makeToolInvokeEvent(
  overrides: Partial<ToolDiagnosticsEvent> = {},
): ToolDiagnosticsEvent {
  return {
    type: 'tool:invoke',
    timestamp: Date.now(),
    toolName: 'test-tool',
    ...overrides,
  };
}

function makeProviderCallEvent(
  overrides: Partial<ProviderDiagnosticsEvent> = {},
): ProviderDiagnosticsEvent {
  return {
    type: 'provider:call',
    timestamp: Date.now(),
    providerName: 'anthropic',
    ...overrides,
  };
}

function createMockCostTracker(): ICostTracker & { recordUsage: ReturnType<typeof vi.fn> } {
  return {
    recordUsage: vi.fn().mockResolvedValue({ id: 'record-1' }),
    getUsage: vi.fn(),
    getAggregate: vi.fn(),
    checkLimit: vi.fn(),
    setLimit: vi.fn(),
    updateLimit: vi.fn(),
    deleteLimit: vi.fn(),
    getLimits: vi.fn(),
    getAlerts: vi.fn(),
    acknowledgeAlert: vi.fn(),
    resolveAlert: vi.fn(),
    generateReport: vi.fn(),
    scheduleReport: vi.fn(),
    getScheduledReports: vi.fn(),
    deleteScheduledReport: vi.fn(),
    estimateCost: vi.fn(),
    updatePricing: vi.fn(),
    getPricing: vi.fn(),
    dispose: vi.fn(),
  } as unknown as ICostTracker & { recordUsage: ReturnType<typeof vi.fn> };
}

function createMockLogger(): ILogger & {
  debug: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

// --- Tests ---

describe('createDiagnosticsProcessor', () => {
  describe('provider:complete events', () => {
    it('maps provider:complete event to correct UsageRecordInput', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(costTracker);

      await processor([makeProviderCompleteEvent()]);

      expect(costTracker.recordUsage).toHaveBeenCalledTimes(1);
      const input = costTracker.recordUsage.mock.calls[0]![0] as UsageRecordInput;
      expect(input.projectId).toBe('proj-1');
      expect(input.engineId).toBe('eng-1');
      expect(input.agentType).toBe('implementer');
      expect(input.taskId).toBe('task-1');
      expect(input.taskType).toBe('implementation');
      expect(input.provider).toBe('anthropic');
      expect(input.model).toBe('claude-sonnet-4');
      expect(input.inputTokens).toBe(1000);
      expect(input.outputTokens).toBe(500);
      expect(input.totalTokens).toBe(1500);
      expect(input.latencyMs).toBe(2000);
      expect(input.success).toBe(true);
    });
  });

  describe('provider:error events', () => {
    it('maps provider:error event with success: false and errorCode', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(costTracker);

      await processor([makeProviderErrorEvent()]);

      expect(costTracker.recordUsage).toHaveBeenCalledTimes(1);
      const input = costTracker.recordUsage.mock.calls[0]![0] as UsageRecordInput;
      expect(input.success).toBe(false);
      expect(input.errorCode).toBe('RATE_LIMIT_EXCEEDED');
      expect(input.provider).toBe('openai');
      expect(input.model).toBe('gpt-4o');
      expect(input.agentType).toBe('reviewer');
      expect(input.taskType).toBe('review');
    });
  });

  describe('tool:complete events', () => {
    it('maps tool:complete event correctly', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(costTracker);

      await processor([makeToolCompleteEvent()]);

      expect(costTracker.recordUsage).toHaveBeenCalledTimes(1);
      const input = costTracker.recordUsage.mock.calls[0]![0] as UsageRecordInput;
      expect(input.provider).toBe('claude-code'); // tool events default to claude-code
      expect(input.model).toBe('unknown'); // tool events have no model
      expect(input.inputTokens).toBe(0); // tool events have no tokens
      expect(input.outputTokens).toBe(0);
      expect(input.totalTokens).toBe(0);
      expect(input.latencyMs).toBe(150);
      expect(input.success).toBe(true);
    });
  });

  describe('tool:error events', () => {
    it('maps tool:error event with success: false and errorCode', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(costTracker);

      await processor([makeToolErrorEvent()]);

      expect(costTracker.recordUsage).toHaveBeenCalledTimes(1);
      const input = costTracker.recordUsage.mock.calls[0]![0] as UsageRecordInput;
      expect(input.success).toBe(false);
      expect(input.errorCode).toBe('TIMEOUT');
      expect(input.provider).toBe('claude-code');
      expect(input.latencyMs).toBe(500);
    });
  });

  describe('costTracker.recordUsage() calls', () => {
    it('calls recordUsage() for each mappable event', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(costTracker);

      await processor([
        makeProviderCompleteEvent(),
        makeProviderErrorEvent(),
        makeToolCompleteEvent(),
        makeToolErrorEvent(),
      ]);

      expect(costTracker.recordUsage).toHaveBeenCalledTimes(4);
    });
  });

  describe('skipped event types', () => {
    it('ignores provider:call events', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(costTracker);

      await processor([makeProviderCallEvent()]);

      expect(costTracker.recordUsage).not.toHaveBeenCalled();
    });

    it('ignores tool:invoke events', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(costTracker);

      await processor([makeToolInvokeEvent()]);

      expect(costTracker.recordUsage).not.toHaveBeenCalled();
    });
  });

  describe('batch processing', () => {
    it('handles batch with mixed event types (only processes completion/error)', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(costTracker);

      const events: DiagnosticsEvent[] = [
        makeToolInvokeEvent(),
        makeProviderCallEvent(),
        makeToolCompleteEvent(),
        makeProviderCompleteEvent(),
        makeToolErrorEvent(),
        makeProviderErrorEvent(),
      ];

      await processor(events);

      // Only 4 completion/error events should be recorded
      expect(costTracker.recordUsage).toHaveBeenCalledTimes(4);
    });

    it('handles empty batch', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(costTracker);

      await expect(processor([])).resolves.toBeUndefined();
      expect(costTracker.recordUsage).not.toHaveBeenCalled();
    });
  });

  describe('provider field and mapProviderName()', () => {
    it('provider field uses mapProviderName() for known providers', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(costTracker);

      await processor([makeProviderCompleteEvent({ providerName: 'openrouter' })]);

      const input = costTracker.recordUsage.mock.calls[0]![0] as UsageRecordInput;
      expect(input.provider).toBe('openrouter');
    });

    it('unknown provider name defaults to "claude-code"', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(costTracker);

      await processor([makeProviderCompleteEvent({ providerName: 'unknown-provider-xyz' })]);

      const input = costTracker.recordUsage.mock.calls[0]![0] as UsageRecordInput;
      expect(input.provider).toBe('claude-code');
    });

    it('tool events default provider to "claude-code" via mapProviderName(undefined)', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(costTracker);

      await processor([makeToolCompleteEvent()]);

      const input = costTracker.recordUsage.mock.calls[0]![0] as UsageRecordInput;
      expect(input.provider).toBe('claude-code');
    });
  });

  describe('context fields from event', () => {
    it('context fields come from event directly', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(costTracker);

      await processor([
        makeProviderCompleteEvent({
          projectId: 'my-project',
          engineId: 'engine-42',
          agentType: 'architect',
          taskId: 'task-99',
          taskType: 'analysis',
        }),
      ]);

      const input = costTracker.recordUsage.mock.calls[0]![0] as UsageRecordInput;
      expect(input.projectId).toBe('my-project');
      expect(input.engineId).toBe('engine-42');
      expect(input.agentType).toBe('architect');
      expect(input.taskId).toBe('task-99');
      expect(input.taskType).toBe('analysis');
    });
  });

  describe('token defaults and validation', () => {
    it('tokens default to 0 when missing (tool events)', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(costTracker);

      await processor([makeToolCompleteEvent()]);

      const input = costTracker.recordUsage.mock.calls[0]![0] as UsageRecordInput;
      expect(input.inputTokens).toBe(0);
      expect(input.outputTokens).toBe(0);
      expect(input.totalTokens).toBe(0);
    });

    it('tokens default to 0 when provider event has no tokens', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(costTracker);

      await processor([makeProviderCompleteEvent({ tokens: undefined })]);

      const input = costTracker.recordUsage.mock.calls[0]![0] as UsageRecordInput;
      expect(input.inputTokens).toBe(0);
      expect(input.outputTokens).toBe(0);
      expect(input.totalTokens).toBe(0);
    });

    it('totalTokens equals input + output', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(costTracker);

      await processor([
        makeProviderCompleteEvent({ tokens: { input: 2000, output: 800 } }),
      ]);

      const input = costTracker.recordUsage.mock.calls[0]![0] as UsageRecordInput;
      expect(input.inputTokens).toBe(2000);
      expect(input.outputTokens).toBe(800);
      expect(input.totalTokens).toBe(2800);
    });

    it('token counts are validated via validateTokenCount() (clamped to max)', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(costTracker);

      // Tokens exceeding MAX_TOKEN_COUNT should be clamped
      await processor([
        makeProviderCompleteEvent({
          tokens: { input: MAX_TOKEN_COUNT + 1000, output: MAX_TOKEN_COUNT + 500 },
        }),
      ]);

      const input = costTracker.recordUsage.mock.calls[0]![0] as UsageRecordInput;
      expect(input.inputTokens).toBe(MAX_TOKEN_COUNT);
      expect(input.outputTokens).toBe(MAX_TOKEN_COUNT);
      // totalTokens = MAX_TOKEN_COUNT + MAX_TOKEN_COUNT, clamped to MAX_TOKEN_COUNT
      expect(input.totalTokens).toBe(MAX_TOKEN_COUNT);
    });

    it('negative token counts are clamped to 0 via validateTokenCount()', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(costTracker);

      await processor([
        makeProviderCompleteEvent({ tokens: { input: -100, output: -50 } }),
      ]);

      const input = costTracker.recordUsage.mock.calls[0]![0] as UsageRecordInput;
      expect(input.inputTokens).toBe(0);
      expect(input.outputTokens).toBe(0);
      expect(input.totalTokens).toBe(0);
    });
  });

  describe('errorCode validation', () => {
    it('errorCode is validated via validateErrorCode()', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(costTracker);

      // Error code exceeding MAX_ERROR_CODE_LENGTH should be truncated
      const longErrorCode = 'E'.repeat(MAX_ERROR_CODE_LENGTH + 50);
      await processor([
        makeProviderErrorEvent({ errorCode: longErrorCode as 'UNKNOWN' }),
      ]);

      const input = costTracker.recordUsage.mock.calls[0]![0] as UsageRecordInput;
      expect(input.errorCode).toHaveLength(MAX_ERROR_CODE_LENGTH);
    });

    it('errorCode is omitted when event has no errorCode', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(costTracker);

      await processor([makeProviderCompleteEvent()]);

      const input = costTracker.recordUsage.mock.calls[0]![0] as UsageRecordInput;
      expect(input.errorCode).toBeUndefined();
    });
  });

  describe('error handling and isolation', () => {
    it('single recordUsage() failure does not prevent remaining events', async () => {
      const costTracker = createMockCostTracker();
      const logger = createMockLogger();
      costTracker.recordUsage
        .mockRejectedValueOnce(new Error('DB connection failed'))
        .mockResolvedValueOnce({ id: 'record-2' });

      const processor = createDiagnosticsProcessor(costTracker, logger);

      await processor([
        makeToolCompleteEvent({ toolName: 'tool-1' }),
        makeToolCompleteEvent({ toolName: 'tool-2' }),
      ]);

      // Both events were attempted
      expect(costTracker.recordUsage).toHaveBeenCalledTimes(2);
    });

    it('errors logged via logger.warn()', async () => {
      const costTracker = createMockCostTracker();
      const logger = createMockLogger();
      costTracker.recordUsage.mockRejectedValueOnce(new Error('DB error'));

      const processor = createDiagnosticsProcessor(costTracker, logger);

      await processor([makeToolCompleteEvent()]);

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        'Diagnostics processor: failed to record usage',
        expect.objectContaining({
          type: 'tool:complete',
          error: 'DB error',
        }),
      );
    });

    it('logs non-Error thrown values as strings', async () => {
      const costTracker = createMockCostTracker();
      const logger = createMockLogger();
      costTracker.recordUsage.mockRejectedValueOnce('string error');

      const processor = createDiagnosticsProcessor(costTracker, logger);

      await processor([makeToolCompleteEvent()]);

      expect(logger.warn).toHaveBeenCalledWith(
        'Diagnostics processor: failed to record usage',
        expect.objectContaining({
          type: 'tool:complete',
          error: 'string error',
        }),
      );
    });

    it('processor works without logger (no crash when logger is undefined)', async () => {
      const costTracker = createMockCostTracker();
      costTracker.recordUsage.mockRejectedValueOnce(new Error('boom'));

      const processor = createDiagnosticsProcessor(costTracker);

      // Should not throw
      await expect(processor([makeToolCompleteEvent()])).resolves.toBeUndefined();
    });
  });

  describe('model defaults', () => {
    it('model defaults to "unknown" for tool events', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(costTracker);

      await processor([makeToolCompleteEvent()]);

      const input = costTracker.recordUsage.mock.calls[0]![0] as UsageRecordInput;
      expect(input.model).toBe('unknown');
    });

    it('model defaults to "unknown" for provider events without model', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(costTracker);

      await processor([makeProviderCompleteEvent({ model: undefined })]);

      const input = costTracker.recordUsage.mock.calls[0]![0] as UsageRecordInput;
      expect(input.model).toBe('unknown');
    });
  });

  describe('type safety', () => {
    it('processor function signature matches DiagnosticsEventProcessor type', () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(costTracker);

      // Verify it's a function and satisfies the type
      expect(typeof processor).toBe('function');

      // Type-level assertion: assignment should compile
      const _typed: DiagnosticsEventProcessor = processor;
      expect(_typed).toBe(processor);
    });
  });

  describe('missing context field defaults', () => {
    it('missing projectId defaults to empty string', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(costTracker);

      await processor([makeToolCompleteEvent({ projectId: undefined })]);

      const input = costTracker.recordUsage.mock.calls[0]![0] as UsageRecordInput;
      expect(input.projectId).toBe('');
    });

    it('missing engineId defaults to empty string', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(costTracker);

      await processor([makeToolCompleteEvent({ engineId: undefined })]);

      const input = costTracker.recordUsage.mock.calls[0]![0] as UsageRecordInput;
      expect(input.engineId).toBe('');
    });

    it('missing agentType defaults to "implementer"', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(costTracker);

      await processor([makeToolCompleteEvent({ agentType: undefined })]);

      const input = costTracker.recordUsage.mock.calls[0]![0] as UsageRecordInput;
      expect(input.agentType).toBe('implementer');
    });

    it('missing taskId defaults to empty string', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(costTracker);

      await processor([makeToolCompleteEvent({ taskId: undefined })]);

      const input = costTracker.recordUsage.mock.calls[0]![0] as UsageRecordInput;
      expect(input.taskId).toBe('');
    });

    it('missing taskType defaults to "implementation"', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(costTracker);

      await processor([makeToolCompleteEvent({ taskType: undefined })]);

      const input = costTracker.recordUsage.mock.calls[0]![0] as UsageRecordInput;
      expect(input.taskType).toBe('implementation');
    });

    it('unknown taskType defaults to "implementation"', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(costTracker);

      await processor([makeToolCompleteEvent({ taskType: 'unknown-task-type' })]);

      const input = costTracker.recordUsage.mock.calls[0]![0] as UsageRecordInput;
      expect(input.taskType).toBe('implementation');
    });

    it('missing latencyMs defaults to 0', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(costTracker);

      await processor([makeToolCompleteEvent({ latencyMs: undefined })]);

      const input = costTracker.recordUsage.mock.calls[0]![0] as UsageRecordInput;
      expect(input.latencyMs).toBe(0);
    });

    it('missing success defaults to false', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(costTracker);

      await processor([makeToolCompleteEvent({ success: undefined })]);

      const input = costTracker.recordUsage.mock.calls[0]![0] as UsageRecordInput;
      expect(input.success).toBe(false);
    });
  });

  describe('event ordering', () => {
    it('processes events in order within a batch', async () => {
      const costTracker = createMockCostTracker();
      const recordedInputs: UsageRecordInput[] = [];
      costTracker.recordUsage.mockImplementation(async (input: UsageRecordInput) => {
        recordedInputs.push(input);
        return { id: `record-${recordedInputs.length}` };
      });

      const processor = createDiagnosticsProcessor(costTracker);

      await processor([
        makeToolCompleteEvent({ taskId: 'first' }),
        makeProviderCompleteEvent({ taskId: 'second' }),
        makeToolErrorEvent({ taskId: 'third' }),
      ]);

      expect(recordedInputs).toHaveLength(3);
      expect(recordedInputs[0]!.taskId).toBe('first');
      expect(recordedInputs[1]!.taskId).toBe('second');
      expect(recordedInputs[2]!.taskId).toBe('third');
    });
  });
});

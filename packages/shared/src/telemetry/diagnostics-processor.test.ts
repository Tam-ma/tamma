/**
 * Unit tests for createDiagnosticsProcessor factory.
 *
 * Tests cover:
 * - Mapping tool:complete events to usage records
 * - Mapping provider:complete events to usage records
 * - Mapping tool:error events with success: false and errorCode
 * - Mapping provider:error events with success: false and errorCode
 * - Skipping tool:invoke and provider:call events
 * - Default values for missing optional fields
 * - Per-event recordUsage failure isolation
 * - Logger warning on recordUsage failure
 * - Processor works without logger
 * - Uses mapProviderName() for provider field (F08)
 * - Uses mapTaskType() for taskType field (F08)
 */

import { describe, it, expect, vi } from 'vitest';
import type {
  ToolDiagnosticsEvent,
  ProviderDiagnosticsEvent,
  DiagnosticsEvent,
} from './diagnostics-event.js';
import type { ILogger } from '../contracts/index.js';
import {
  createDiagnosticsProcessor,
  type IDiagnosticsCostTracker,
  type DiagnosticsUsageRecordInput,
  type DiagnosticsProcessorOptions,
} from './diagnostics-processor.js';

// --- Helper factories ---

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

function createMockCostTracker(): IDiagnosticsCostTracker & { recordUsage: ReturnType<typeof vi.fn> } {
  return {
    recordUsage: vi.fn().mockResolvedValue({ id: 'record-1' }),
  };
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

// Identity mappers by default
function identityMapProviderName(name: string): string {
  return name;
}

function identityMapTaskType(taskType: string): string {
  return taskType;
}

function makeOptions(overrides: Partial<DiagnosticsProcessorOptions> = {}): DiagnosticsProcessorOptions {
  return {
    costTracker: createMockCostTracker(),
    mapProviderName: identityMapProviderName,
    mapTaskType: identityMapTaskType,
    ...overrides,
  };
}

// --- Tests ---

describe('createDiagnosticsProcessor', () => {
  describe('tool:complete events', () => {
    it('maps tool:complete event to usage record with all fields', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(makeOptions({ costTracker }));

      await processor([makeToolCompleteEvent()]);

      expect(costTracker.recordUsage).toHaveBeenCalledTimes(1);
      const input = costTracker.recordUsage.mock.calls[0]![0] as DiagnosticsUsageRecordInput;
      expect(input.projectId).toBe('proj-1');
      expect(input.engineId).toBe('eng-1');
      expect(input.agentType).toBe('implementer');
      expect(input.taskId).toBe('task-1');
      expect(input.taskType).toBe('implementation');
      expect(input.provider).toBe('claude-code'); // tool events default to claude-code
      expect(input.model).toBe('unknown'); // tool events default to unknown
      expect(input.inputTokens).toBe(0); // tool events have no tokens
      expect(input.outputTokens).toBe(0);
      expect(input.totalTokens).toBe(0);
      expect(input.latencyMs).toBe(150);
      expect(input.success).toBe(true);
    });
  });

  describe('provider:complete events', () => {
    it('maps provider:complete event to usage record with all fields', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(makeOptions({ costTracker }));

      await processor([makeProviderCompleteEvent()]);

      expect(costTracker.recordUsage).toHaveBeenCalledTimes(1);
      const input = costTracker.recordUsage.mock.calls[0]![0] as DiagnosticsUsageRecordInput;
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

  describe('tool:error events', () => {
    it('maps tool:error event with success: false and errorCode', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(makeOptions({ costTracker }));

      await processor([makeToolErrorEvent()]);

      expect(costTracker.recordUsage).toHaveBeenCalledTimes(1);
      const input = costTracker.recordUsage.mock.calls[0]![0] as DiagnosticsUsageRecordInput;
      expect(input.success).toBe(false);
      expect(input.errorCode).toBe('TIMEOUT');
      expect(input.latencyMs).toBe(500);
      expect(input.provider).toBe('claude-code');
    });
  });

  describe('provider:error events', () => {
    it('maps provider:error event with success: false and errorCode', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(makeOptions({ costTracker }));

      await processor([makeProviderErrorEvent()]);

      expect(costTracker.recordUsage).toHaveBeenCalledTimes(1);
      const input = costTracker.recordUsage.mock.calls[0]![0] as DiagnosticsUsageRecordInput;
      expect(input.success).toBe(false);
      expect(input.errorCode).toBe('RATE_LIMIT_EXCEEDED');
      expect(input.provider).toBe('openai');
      expect(input.model).toBe('gpt-4o');
      expect(input.agentType).toBe('reviewer');
      expect(input.taskType).toBe('review');
    });
  });

  describe('skipped event types', () => {
    it('skips tool:invoke events (does not call recordUsage)', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(makeOptions({ costTracker }));

      await processor([makeToolInvokeEvent()]);

      expect(costTracker.recordUsage).not.toHaveBeenCalled();
    });

    it('skips provider:call events (does not call recordUsage)', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(makeOptions({ costTracker }));

      await processor([makeProviderCallEvent()]);

      expect(costTracker.recordUsage).not.toHaveBeenCalled();
    });

    it('processes only completion/error events in a mixed batch', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(makeOptions({ costTracker }));

      const events: DiagnosticsEvent[] = [
        makeToolInvokeEvent(),
        makeProviderCallEvent(),
        makeToolCompleteEvent(),
        makeProviderCompleteEvent(),
        makeToolErrorEvent(),
        makeProviderErrorEvent(),
      ];

      await processor(events);

      // Should only record the 4 completion/error events
      expect(costTracker.recordUsage).toHaveBeenCalledTimes(4);
    });
  });

  describe('default values for missing fields', () => {
    it('missing providerName defaults to "claude-code" for tool events', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(makeOptions({ costTracker }));

      // Tool events do not have providerName -- should default to 'claude-code'
      await processor([makeToolCompleteEvent()]);

      const input = costTracker.recordUsage.mock.calls[0]![0] as DiagnosticsUsageRecordInput;
      expect(input.provider).toBe('claude-code');
    });

    it('missing model defaults to "unknown" for tool events', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(makeOptions({ costTracker }));

      await processor([makeToolCompleteEvent()]);

      const input = costTracker.recordUsage.mock.calls[0]![0] as DiagnosticsUsageRecordInput;
      expect(input.model).toBe('unknown');
    });

    it('missing model defaults to "unknown" for provider events without model', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(makeOptions({ costTracker }));

      await processor([makeProviderCompleteEvent({ model: undefined })]);

      const input = costTracker.recordUsage.mock.calls[0]![0] as DiagnosticsUsageRecordInput;
      expect(input.model).toBe('unknown');
    });

    it('missing tokens defaults to { input: 0, output: 0 } and totalTokens: 0', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(makeOptions({ costTracker }));

      // Provider event without tokens
      await processor([makeProviderCompleteEvent({ tokens: undefined })]);

      const input = costTracker.recordUsage.mock.calls[0]![0] as DiagnosticsUsageRecordInput;
      expect(input.inputTokens).toBe(0);
      expect(input.outputTokens).toBe(0);
      expect(input.totalTokens).toBe(0);
    });

    it('missing latencyMs defaults to 0', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(makeOptions({ costTracker }));

      await processor([makeToolCompleteEvent({ latencyMs: undefined })]);

      const input = costTracker.recordUsage.mock.calls[0]![0] as DiagnosticsUsageRecordInput;
      expect(input.latencyMs).toBe(0);
    });

    it('missing success defaults to false', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(makeOptions({ costTracker }));

      await processor([makeToolCompleteEvent({ success: undefined })]);

      const input = costTracker.recordUsage.mock.calls[0]![0] as DiagnosticsUsageRecordInput;
      expect(input.success).toBe(false);
    });

    it('missing projectId defaults to empty string', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(makeOptions({ costTracker }));

      await processor([makeToolCompleteEvent({ projectId: undefined })]);

      const input = costTracker.recordUsage.mock.calls[0]![0] as DiagnosticsUsageRecordInput;
      expect(input.projectId).toBe('');
    });

    it('missing engineId defaults to empty string', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(makeOptions({ costTracker }));

      await processor([makeToolCompleteEvent({ engineId: undefined })]);

      const input = costTracker.recordUsage.mock.calls[0]![0] as DiagnosticsUsageRecordInput;
      expect(input.engineId).toBe('');
    });

    it('missing agentType defaults to "implementer"', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(makeOptions({ costTracker }));

      await processor([makeToolCompleteEvent({ agentType: undefined })]);

      const input = costTracker.recordUsage.mock.calls[0]![0] as DiagnosticsUsageRecordInput;
      expect(input.agentType).toBe('implementer');
    });

    it('missing taskId defaults to empty string', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(makeOptions({ costTracker }));

      await processor([makeToolCompleteEvent({ taskId: undefined })]);

      const input = costTracker.recordUsage.mock.calls[0]![0] as DiagnosticsUsageRecordInput;
      expect(input.taskId).toBe('');
    });

    it('missing taskType defaults to "implementation" and is mapped', async () => {
      const mapTaskType = vi.fn().mockReturnValue('implementation');
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(makeOptions({ costTracker, mapTaskType }));

      await processor([makeToolCompleteEvent({ taskType: undefined })]);

      expect(mapTaskType).toHaveBeenCalledWith('implementation');
    });
  });

  describe('error handling and isolation', () => {
    it('per-event recordUsage failure is caught and does not prevent processing remaining events', async () => {
      const costTracker = createMockCostTracker();
      const logger = createMockLogger();
      costTracker.recordUsage
        .mockRejectedValueOnce(new Error('DB connection failed'))
        .mockResolvedValueOnce({ id: 'record-2' });

      const processor = createDiagnosticsProcessor(
        makeOptions({ costTracker, logger }),
      );

      await processor([
        makeToolCompleteEvent({ toolName: 'tool-1' }),
        makeToolCompleteEvent({ toolName: 'tool-2' }),
      ]);

      // Both events were attempted
      expect(costTracker.recordUsage).toHaveBeenCalledTimes(2);
    });

    it('logger warning is called with event type when recordUsage throws', async () => {
      const costTracker = createMockCostTracker();
      const logger = createMockLogger();
      costTracker.recordUsage.mockRejectedValueOnce(new Error('DB error'));

      const processor = createDiagnosticsProcessor(
        makeOptions({ costTracker, logger }),
      );

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

    it('logger warning handles non-Error thrown values', async () => {
      const costTracker = createMockCostTracker();
      const logger = createMockLogger();
      costTracker.recordUsage.mockRejectedValueOnce('string error');

      const processor = createDiagnosticsProcessor(
        makeOptions({ costTracker, logger }),
      );

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

      const processor = createDiagnosticsProcessor(
        makeOptions({ costTracker, logger: undefined }),
      );

      // Should not throw
      await expect(
        processor([makeToolCompleteEvent()]),
      ).resolves.toBeUndefined();
    });
  });

  describe('mapProviderName and mapTaskType usage (F08)', () => {
    it('uses mapProviderName() for provider field instead of unsafe cast', async () => {
      const costTracker = createMockCostTracker();
      const mapProviderName = vi.fn().mockReturnValue('anthropic');
      const processor = createDiagnosticsProcessor(
        makeOptions({ costTracker, mapProviderName }),
      );

      await processor([makeProviderCompleteEvent({ providerName: 'claude-3' })]);

      expect(mapProviderName).toHaveBeenCalledWith('claude-3');
      const input = costTracker.recordUsage.mock.calls[0]![0] as DiagnosticsUsageRecordInput;
      expect(input.provider).toBe('anthropic');
    });

    it('uses mapTaskType() for taskType field instead of unsafe cast', async () => {
      const costTracker = createMockCostTracker();
      const mapTaskType = vi.fn().mockReturnValue('analysis');
      const processor = createDiagnosticsProcessor(
        makeOptions({ costTracker, mapTaskType }),
      );

      await processor([makeToolCompleteEvent({ taskType: 'deep-analysis' })]);

      expect(mapTaskType).toHaveBeenCalledWith('deep-analysis');
      const input = costTracker.recordUsage.mock.calls[0]![0] as DiagnosticsUsageRecordInput;
      expect(input.taskType).toBe('analysis');
    });

    it('mapProviderName receives "claude-code" default for tool events', async () => {
      const costTracker = createMockCostTracker();
      const mapProviderName = vi.fn().mockReturnValue('claude-code');
      const processor = createDiagnosticsProcessor(
        makeOptions({ costTracker, mapProviderName }),
      );

      await processor([makeToolCompleteEvent()]);

      expect(mapProviderName).toHaveBeenCalledWith('claude-code');
    });

    it('mapTaskType receives "implementation" default when taskType is missing', async () => {
      const costTracker = createMockCostTracker();
      const mapTaskType = vi.fn().mockReturnValue('implementation');
      const processor = createDiagnosticsProcessor(
        makeOptions({ costTracker, mapTaskType }),
      );

      await processor([makeToolCompleteEvent({ taskType: undefined })]);

      expect(mapTaskType).toHaveBeenCalledWith('implementation');
    });
  });

  describe('provider event field extraction (F01)', () => {
    it('extracts providerName from ProviderDiagnosticsEvent', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(makeOptions({ costTracker }));

      await processor([makeProviderCompleteEvent({ providerName: 'google' })]);

      const input = costTracker.recordUsage.mock.calls[0]![0] as DiagnosticsUsageRecordInput;
      expect(input.provider).toBe('google');
    });

    it('extracts model from ProviderDiagnosticsEvent', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(makeOptions({ costTracker }));

      await processor([makeProviderCompleteEvent({ model: 'gemini-pro' })]);

      const input = costTracker.recordUsage.mock.calls[0]![0] as DiagnosticsUsageRecordInput;
      expect(input.model).toBe('gemini-pro');
    });

    it('extracts tokens from ProviderDiagnosticsEvent', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(makeOptions({ costTracker }));

      await processor([
        makeProviderCompleteEvent({ tokens: { input: 2000, output: 800 } }),
      ]);

      const input = costTracker.recordUsage.mock.calls[0]![0] as DiagnosticsUsageRecordInput;
      expect(input.inputTokens).toBe(2000);
      expect(input.outputTokens).toBe(800);
      expect(input.totalTokens).toBe(2800);
    });
  });

  describe('batch processing', () => {
    it('processes an empty batch without errors', async () => {
      const costTracker = createMockCostTracker();
      const processor = createDiagnosticsProcessor(makeOptions({ costTracker }));

      await expect(processor([])).resolves.toBeUndefined();
      expect(costTracker.recordUsage).not.toHaveBeenCalled();
    });

    it('processes events in order within a batch', async () => {
      const costTracker = createMockCostTracker();
      const recordedInputs: DiagnosticsUsageRecordInput[] = [];
      costTracker.recordUsage.mockImplementation(async (input: DiagnosticsUsageRecordInput) => {
        recordedInputs.push(input);
        return { id: `record-${recordedInputs.length}` };
      });

      const processor = createDiagnosticsProcessor(makeOptions({ costTracker }));

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

  describe('IDiagnosticsProcessor interface', () => {
    it('returned function satisfies DiagnosticsEventProcessor type', () => {
      const processor = createDiagnosticsProcessor(makeOptions());

      // The function signature should match DiagnosticsEventProcessor
      expect(typeof processor).toBe('function');
    });
  });
});

/**
 * Diagnostics Processor for Cost Tracking
 *
 * Concrete factory that bridges DiagnosticsQueue events to
 * ICostTracker.recordUsage() using real validation functions
 * (validateTokenCount, validateErrorCode) and mapProviderName().
 *
 * This module lives in @tamma/providers because it wires concrete
 * provider-layer dependencies (mapProviderName, ICostTracker) that
 * the generic @tamma/shared processor does not depend on directly.
 */

import type { ILogger, AgentType } from '@tamma/shared';
import type {
  DiagnosticsEvent,
  DiagnosticsEventProcessor,
  ProviderDiagnosticsEvent,
} from '@tamma/shared/telemetry';
import { validateTokenCount, validateErrorCode } from '@tamma/shared/telemetry';
import type { ICostTracker, UsageRecordInput, TaskType } from '@tamma/cost-monitor';
import { mapProviderName } from './provider-name-mapping.js';

// --- Constants ---

/**
 * Set of event types that should be processed (completion and error events).
 * Call/invoke events are skipped since they don't carry outcome data.
 */
const PROCESSABLE_EVENT_TYPES = new Set([
  'tool:complete',
  'tool:error',
  'provider:complete',
  'provider:error',
]);

/**
 * Set of valid TaskType values from @tamma/cost-monitor.
 */
const VALID_TASK_TYPES = new Set<string>([
  'analysis',
  'planning',
  'implementation',
  'review',
  'testing',
  'documentation',
  'research',
]);

const DEFAULT_TASK_TYPE: TaskType = 'implementation';

// --- Type Guards ---

function _isProviderEvent(event: DiagnosticsEvent): event is ProviderDiagnosticsEvent {
  return (
    event.type === 'provider:call' ||
    event.type === 'provider:complete' ||
    event.type === 'provider:error'
  );
}

// --- Task Type Mapping ---

/**
 * Map a raw task type string to a valid TaskType value.
 * Returns 'implementation' as default if the value is not recognized.
 */
function _mapTaskType(value: string | undefined): TaskType {
  const resolved = value ?? DEFAULT_TASK_TYPE;
  if (VALID_TASK_TYPES.has(resolved)) {
    return resolved as TaskType;
  }
  return DEFAULT_TASK_TYPE;
}

// --- Factory ---

/**
 * Create a DiagnosticsEventProcessor that bridges DiagnosticsQueue events
 * to ICostTracker.recordUsage().
 *
 * Only processes completion and error events:
 * - `provider:complete`, `provider:error`
 * - `tool:complete`, `tool:error`
 *
 * Skips `provider:call` and `tool:invoke` events.
 *
 * Token counts are validated via validateTokenCount() (clamped to [0, 10_000_000]).
 * Error codes are validated via validateErrorCode() (truncated to 100 chars).
 * Provider names are mapped via mapProviderName() (defaults to 'claude-code').
 *
 * Per-event errors are caught and logged as warnings, so a single failure
 * does not prevent processing the remaining events in the batch.
 *
 * @param costTracker - The cost tracker instance to record usage to
 * @param logger - Optional logger for warning on per-event errors
 * @returns A DiagnosticsEventProcessor function
 */
export function createDiagnosticsProcessor(
  costTracker: ICostTracker,
  logger?: ILogger,
): DiagnosticsEventProcessor {
  return async (events: DiagnosticsEvent[]): Promise<void> => {
    for (const event of events) {
      // Only process completion and error events
      if (!PROCESSABLE_EVENT_TYPES.has(event.type)) {
        continue;
      }

      try {
        // Extract provider-specific fields using discriminated union
        let providerName: string | undefined;
        let model = 'unknown';
        let inputTokens = 0;
        let outputTokens = 0;

        if (_isProviderEvent(event)) {
          providerName = event.providerName;
          model = event.model ?? 'unknown';
          if (event.tokens) {
            inputTokens = event.tokens.input;
            outputTokens = event.tokens.output;
          }
        }

        // Validate token counts
        const validatedInputTokens = validateTokenCount(inputTokens);
        const validatedOutputTokens = validateTokenCount(outputTokens);
        const validatedTotalTokens = validateTokenCount(validatedInputTokens + validatedOutputTokens);

        // Build usage record input
        const usageInput: UsageRecordInput = {
          projectId: event.projectId ?? '',
          engineId: event.engineId ?? '',
          agentType: (event.agentType ?? 'implementer') as AgentType,
          taskId: event.taskId ?? '',
          taskType: _mapTaskType(event.taskType),
          provider: mapProviderName(providerName),
          model,
          inputTokens: validatedInputTokens,
          outputTokens: validatedOutputTokens,
          totalTokens: validatedTotalTokens,
          latencyMs: event.latencyMs ?? 0,
          success: event.success ?? false,
        };

        // Conditionally assign optional fields to satisfy exactOptionalPropertyTypes
        const validatedErrorCode = validateErrorCode(event.errorCode);
        if (validatedErrorCode !== undefined) {
          usageInput.errorCode = validatedErrorCode;
        }

        await costTracker.recordUsage(usageInput);
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger?.warn('Diagnostics processor: failed to record usage', {
          type: event.type,
          error: errorMessage,
        });
      }
    }
  };
}

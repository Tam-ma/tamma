/**
 * Diagnostics Event Types
 *
 * Discriminated union types for telemetry events emitted by
 * providers (provider:*) and MCP tool invocations (tool:*).
 * Used by DiagnosticsQueue for batched processing.
 */

import type { AgentType } from '../types/knowledge.js';

/**
 * All supported diagnostics event types.
 * Tool events track MCP tool invocations; provider events track LLM API calls.
 */
export type DiagnosticsEventType =
  | 'tool:invoke'
  | 'tool:complete'
  | 'tool:error'
  | 'provider:call'
  | 'provider:complete'
  | 'provider:error';

/**
 * Typed error codes for diagnostics events.
 */
export type DiagnosticsErrorCode =
  | 'RATE_LIMIT_EXCEEDED'
  | 'QUOTA_EXCEEDED'
  | 'AUTH_FAILED'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'TASK_FAILED'
  | 'UNKNOWN';

/**
 * Base interface for all diagnostics events.
 * Contains shared fields for both tool and provider events.
 */
export interface DiagnosticsEventBase {
  /** Discriminator for the event kind */
  type: DiagnosticsEventType;
  /** Unix epoch timestamp from Date.now() */
  timestamp: number;
  /** UUID for pairing start/end events (e.g., invoke -> complete) */
  correlationId?: string;

  // Context fields -- optional, populated by bridge wiring from runtime context
  /** The agent role emitting this event */
  agentType?: AgentType;
  /** Project identifier */
  projectId?: string;
  /** Engine run identifier */
  engineId?: string;
  /** Task identifier */
  taskId?: string;
  /** Task type classification */
  taskType?: string;

  // Outcome fields -- populated for complete/error events
  /** Latency in milliseconds */
  latencyMs?: number;
  /** Whether the operation succeeded */
  success?: boolean;
  /** Cost in USD (for provider events) */
  costUsd?: number;
  /** Typed error code */
  errorCode?: DiagnosticsErrorCode;
  /** Human-readable error description */
  errorMessage?: string;
}

/**
 * Diagnostics event for MCP tool invocations.
 * Requires `toolName`; discriminated by tool:* event types.
 */
export interface ToolDiagnosticsEvent extends DiagnosticsEventBase {
  type: 'tool:invoke' | 'tool:complete' | 'tool:error';
  /** Name of the MCP tool (required for tool events) */
  toolName: string;
  /** Name of the MCP server hosting the tool */
  serverName?: string;
  /** Tool invocation arguments (truncated for diagnostics) */
  args?: Record<string, unknown>;
}

/**
 * Diagnostics event for LLM provider API calls.
 * Requires `providerName`; discriminated by provider:* event types.
 */
export interface ProviderDiagnosticsEvent extends DiagnosticsEventBase {
  type: 'provider:call' | 'provider:complete' | 'provider:error';
  /** Name of the LLM provider (required for provider events) */
  providerName: string;
  /** Model identifier */
  model?: string;
  /** Token usage counts */
  tokens?: { input: number; output: number };
}

/**
 * Discriminated union of all diagnostics events.
 * Use `event.type` to narrow: tool:* events have `toolName`,
 * provider:* events have `providerName`.
 */
export type DiagnosticsEvent = ToolDiagnosticsEvent | ProviderDiagnosticsEvent;

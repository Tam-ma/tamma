/**
 * Engine transport contract.
 *
 * Defines the communication layer between a UI/CLI front-end and the
 * TammaEngine. Two implementations exist:
 * - InProcessTransport: direct method calls for the CLI
 * - RemoteTransport: HTTP + SSE for the web dashboard
 */

import type { EngineState, IssueData, DevelopmentPlan, EngineEvent } from '../types/index.js';

export type EngineCommand =
  | { type: 'start'; options?: { once?: boolean } }
  | { type: 'stop' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'approve' }
  | { type: 'reject'; feedback?: string }
  | { type: 'skip' }
  | { type: 'process-issue'; issueNumber: number }
  | { type: 'describe-work'; description: string };

export interface EngineStatsSummary {
  issuesProcessed: number;
  totalCostUsd: number;
  startedAt: number;
}

export interface EngineStateUpdate {
  state: EngineState;
  issue: IssueData | null;
  stats: EngineStatsSummary;
}

export interface EngineLogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  timestamp: number;
  context?: Record<string, unknown>;
}

export interface CommandResult {
  ok: boolean;
  error?: string;
}

export interface IEngineTransport {
  /** Send a command to the engine and receive acknowledgement. */
  sendCommand(command: EngineCommand): Promise<CommandResult>;
  onStateUpdate(listener: (update: EngineStateUpdate) => void): () => void;
  onLog(listener: (entry: EngineLogEntry) => void): () => void;
  onApprovalRequest(listener: (plan: DevelopmentPlan) => void): () => void;
  onEvent(listener: (event: EngineEvent) => void): () => void;
  dispose(): Promise<void>;
}

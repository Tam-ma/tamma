import type { EngineState, IssueData, TammaConfig, DevelopmentPlan } from '@tamma/shared';
import type { EngineStats } from '@tamma/orchestrator';
import type { IGitPlatform } from '@tamma/platforms';
import type { LogEmitter } from './log-emitter.js';

/** Listener that receives engine state updates. */
export type StateListener = (state: EngineState, issue: IssueData | null, stats: EngineStats) => void;

/** Simple pub/sub bridge between the engine callback (non-React) and the React component. */
export interface StateEmitter {
  listener: StateListener | null;
  emit: StateListener;
  /** Re-emit the last known state. Used by approvalHandler to notify React after setting the ref. */
  reEmit: () => void;
}

/** Pending approval that the React component can resolve. */
export interface PendingApproval {
  plan: DevelopmentPlan;
  resolve: (decision: 'approve' | 'reject' | 'skip') => void;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: number;
  context?: Record<string, unknown>;
}

export interface SlashCommand {
  name: string;
  description: string;
  execute: (args: string, ctx: CommandContext) => void;
}

export interface CommandContext {
  config: TammaConfig;
  stats: EngineStats;
  state: EngineState;
  issue: IssueData | null;
  logEmitter: LogEmitter;
  platform: IGitPlatform;
  showDebug: boolean;
  paused: boolean;
  setShowDebug: (show: boolean) => void;
  setPaused: (paused: boolean) => void;
  shutdown: () => void;
  skipIssue: () => void;
  approveCurrentPlan: () => void;
  rejectCurrentPlan: (feedback?: string) => void;
}

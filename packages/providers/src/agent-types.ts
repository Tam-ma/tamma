import type { AgentTaskResult } from '@tamma/shared';

export interface AgentTaskConfig {
  prompt: string;
  cwd: string;
  model?: string;
  maxBudgetUsd?: number;
  allowedTools?: string[];
  permissionMode?: 'bypassPermissions' | 'default';
  outputFormat?: { type: 'json_schema'; schema: Record<string, unknown> };
  sessionId?: string;
}

export interface AgentProgressEvent {
  type: 'progress' | 'tool_use' | 'text' | 'cost_update';
  message: string;
  timestamp: number;
  costSoFar?: number;
}

export type AgentProgressCallback = (event: AgentProgressEvent) => void;

export interface IAgentProvider {
  executeTask(
    config: AgentTaskConfig,
    onProgress?: AgentProgressCallback,
  ): Promise<AgentTaskResult>;
  isAvailable(): Promise<boolean>;
  dispose(): Promise<void>;
}

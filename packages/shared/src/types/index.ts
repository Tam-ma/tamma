/**
 * Common types and interfaces shared across the Tamma platform
 */

import type { ILogger } from '../contracts/index.js';

// --- Configuration ---

export interface TammaConfig {
  mode: 'standalone' | 'orchestrator' | 'worker';
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  github: GitHubConfig;
  agent: AgentConfig;
  engine: EngineConfig;
}

export interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
  issueLabels: string[];
  excludeLabels: string[];
  botUsername: string;
}

export interface AgentConfig {
  model: string;
  maxBudgetUsd: number;
  allowedTools: string[];
  permissionMode: 'bypassPermissions' | 'default';
}

export interface EngineConfig {
  pollIntervalMs: number;
  workingDirectory: string;
  maxRetries: number;
  approvalMode: 'cli' | 'auto';
}

// --- Engine State Machine (Story 1.5-1) ---

export enum EngineState {
  IDLE = 'IDLE',
  SELECTING_ISSUE = 'SELECTING_ISSUE',
  ANALYZING = 'ANALYZING',
  PLANNING = 'PLANNING',
  AWAITING_APPROVAL = 'AWAITING_APPROVAL',
  IMPLEMENTING = 'IMPLEMENTING',
  CREATING_PR = 'CREATING_PR',
  MONITORING = 'MONITORING',
  MERGING = 'MERGING',
  ERROR = 'ERROR',
}

// --- Issue Types ---

export interface IssueComment {
  id: number;
  author: string;
  body: string;
  createdAt: string;
}

export interface IssueData {
  number: number;
  title: string;
  body: string;
  labels: string[];
  url: string;
  comments: IssueComment[];
  relatedIssueNumbers: number[];
  createdAt: string;
}

// --- Development Plan (Story 2.3) ---

export interface PlannedFileChange {
  filePath: string;
  action: 'create' | 'modify' | 'delete';
  description: string;
}

export interface DevelopmentPlan {
  issueNumber: number;
  summary: string;
  approach: string;
  fileChanges: PlannedFileChange[];
  testingStrategy: string;
  estimatedComplexity: 'low' | 'medium' | 'high';
  risks: string[];
}

// --- Agent Task Result ---

export interface AgentTaskResult {
  success: boolean;
  output: string;
  costUsd: number;
  durationMs: number;
  error?: string;
}

// --- Pull Request Info ---

export interface PullRequestInfo {
  number: number;
  url: string;
  title: string;
  body: string;
  branch: string;
  status: 'open' | 'closed' | 'merged';
}

// --- Launch Context (Story 1.5-1 AC#4) ---

export interface LaunchContext {
  mode: 'cli' | 'service' | 'web' | 'worker';
  config: TammaConfig;
  logger: ILogger;
}

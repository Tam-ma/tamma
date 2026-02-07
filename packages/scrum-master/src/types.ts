/**
 * Scrum Master Task Loop Types
 * @module @tamma/scrum-master/types
 */

import type { AgentType } from '@tamma/gates';
import type {
  KnowledgeCheckResult,
  KnowledgeEntry,
  LearningCapture as KBLearningCapture,
} from '@tamma/shared';
import type { LimitCheckResult, UsageRecord } from '@tamma/cost-monitor';

// ============================================
// State Machine States
// ============================================

export enum ScrumMasterState {
  IDLE = 'IDLE',
  PLANNING = 'PLANNING',
  AWAITING_APPROVAL = 'AWAITING_APPROVAL',
  IMPLEMENTING = 'IMPLEMENTING',
  REVIEWING = 'REVIEWING',
  LEARNING = 'LEARNING',
  COMPLETED = 'COMPLETED',
  BLOCKED = 'BLOCKED',
  ESCALATED = 'ESCALATED',
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED',
}

// ============================================
// Task Types
// ============================================

export type TaskType =
  | 'feature'
  | 'bugfix'
  | 'refactor'
  | 'test'
  | 'docs'
  | 'chore';

export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string;
  type: TaskType;
  priority: TaskPriority;
  issueNumber?: number;
  issueUrl?: string;
  labels: string[];
  createdAt: Date;
  metadata?: Record<string, unknown>;
}

// ============================================
// Development Plan Types
// ============================================

export interface PlannedFileChange {
  path: string;
  action: 'create' | 'modify' | 'delete';
  description: string;
  estimatedLines: number;
}

export interface ScrumMasterPlan {
  taskId: string;
  summary: string;
  approach: string;
  fileChanges: PlannedFileChange[];
  testingStrategy: string;
  complexity: 'low' | 'medium' | 'high';
  estimatedTokens: number;
  estimatedCostUsd: number;
  risks: string[];
  dependencies: string[];
  generatedAt: Date;
  version: number;
}

// ============================================
// Approval Types
// ============================================

export type ApprovalDecision = 'approved' | 'rejected' | 'needs_revision';

export interface PlanAdjustment {
  field: string;
  originalValue: unknown;
  newValue: unknown;
  reason: string;
}

export interface ApprovalStatus {
  status: 'pending' | 'approved' | 'rejected' | 'auto_approved';
  approvedBy?: string;
  approvedAt?: Date;
  reason?: string;
  adjustments?: PlanAdjustment[];
}

export interface ApprovalRequest {
  id: string;
  taskId: string;
  plan: ScrumMasterPlan;
  riskLevel: RiskLevel;
  knowledgeCheck: KnowledgeCheckResult;
  requestedAt: Date;
  status: ApprovalStatus;
}

// ============================================
// Implementation Types
// ============================================

export interface ImplementationResult {
  success: boolean;
  output: string;
  costUsd: number;
  durationMs: number;
  filesModified: string[];
  testsRun: number;
  testsPassed: number;
  error?: string;
  sessionId?: string;
}

// ============================================
// Review Types
// ============================================

export type ReviewIssueSeverity = 'info' | 'warning' | 'error';
export type ReviewIssueCategory =
  | 'code'
  | 'test'
  | 'style'
  | 'security'
  | 'performance';

export interface ReviewIssue {
  severity: ReviewIssueSeverity;
  category: ReviewIssueCategory;
  message: string;
  file?: string;
  line?: number;
}

export interface QualityCheck {
  name: string;
  passed: boolean;
  message: string;
}

export interface ReviewResult {
  passed: boolean;
  score: number; // 0-100
  issues: ReviewIssue[];
  suggestions: string[];
  qualityChecks: QualityCheck[];
}

// ============================================
// Learning Types
// ============================================

export interface LearningCapture {
  taskId: string;
  type: 'success' | 'failure' | 'improvement';
  title: string;
  description: string;
  keywords: string[];
  priority: 'low' | 'medium' | 'high';
  suggestedKnowledgeType: 'recommendation' | 'prohibition' | 'learning';
  status: 'pending' | 'approved' | 'rejected';
}

// ============================================
// Risk Assessment Types
// ============================================

export type RiskLevel = 'low' | 'medium' | 'high';

export interface RiskAssessment {
  level: RiskLevel;
  score: number;
  factors: RiskFactor[];
  requiresApproval: boolean;
}

export interface RiskFactor {
  name: string;
  score: number;
  description: string;
}

// ============================================
// Blocker Types
// ============================================

export type BlockerType =
  | 'permission_denied'
  | 'knowledge_prohibition'
  | 'cost_limit_exceeded'
  | 'timeout'
  | 'implementation_failed'
  | 'review_failed'
  | 'external_dependency'
  | 'user_intervention';

export interface Blocker {
  id: string;
  type: BlockerType;
  message: string;
  taskId: string;
  timestamp: Date;
  resolved: boolean;
  resolvedAt?: Date;
  resolution?: string;
  escalated: boolean;
}

// ============================================
// Task Loop Context
// ============================================

export interface TaskLoopContext {
  task: Task;
  plan?: ScrumMasterPlan;
  knowledgeCheck?: KnowledgeCheckResult;
  riskAssessment?: RiskAssessment;
  approvalStatus?: ApprovalStatus;
  implementation?: ImplementationResult;
  review?: ReviewResult;
  learnings: LearningCapture[];
  blockers: Blocker[];
  retryCount: number;
  maxRetries: number;
  startTime: Date;
  errors: TaskError[];
  costBudgetUsd: number;
  currentCostUsd: number;
}

// ============================================
// Task Result
// ============================================

export interface TaskResult {
  taskId: string;
  success: boolean;
  state: ScrumMasterState;
  plan?: ScrumMasterPlan;
  implementation?: ImplementationResult;
  review?: ReviewResult;
  learnings: LearningCapture[];
  totalCostUsd: number;
  totalDurationMs: number;
  retryCount: number;
  error?: string;
  completedAt: Date;
}

// ============================================
// Task Error
// ============================================

export interface TaskError {
  state: ScrumMasterState;
  message: string;
  timestamp: Date;
  recoverable: boolean;
  context?: Record<string, unknown>;
}

// ============================================
// Alert Types
// ============================================

export type AlertType =
  | 'approval_needed'
  | 'task_blocked'
  | 'max_retries_exceeded'
  | 'review_failed'
  | 'cost_limit_warning'
  | 'error'
  | 'escalation';

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface Alert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  details: string;
  taskId?: string;
  actions: string[];
  createdAt: Date;
  acknowledged: boolean;
  acknowledgedAt?: Date;
  acknowledgedBy?: string;
}

// ============================================
// Agent Coordination Types
// ============================================

export interface AgentInfo {
  id: string;
  type: AgentType;
  status: 'idle' | 'busy' | 'error';
  currentTaskId?: string;
  capabilities: string[];
}

export interface AgentAssignment {
  agentId: string;
  taskId: string;
  assignedAt: Date;
  role: AgentType;
}

// ============================================
// Engine Types
// ============================================

export interface EngineExecutionConfig {
  maxTokens?: number;
  maxCostUsd?: number;
  timeoutMs?: number;
  allowedTools?: string[];
}

export interface EngineProgressEvent {
  type: 'progress' | 'output' | 'tool_use' | 'error';
  message: string;
  data?: Record<string, unknown>;
  timestamp: Date;
}

export interface IEngine {
  id: string;
  status: 'idle' | 'busy' | 'error';
  execute(
    prompt: string,
    config: EngineExecutionConfig,
    onProgress?: (event: EngineProgressEvent) => void
  ): Promise<ImplementationResult>;
}

// ============================================
// Engine Pool Types
// ============================================

export interface EnginePoolStatus {
  total: number;
  available: number;
  busy: number;
  error: number;
}

export interface IEnginePool {
  acquire(projectId: string): Promise<IEngine>;
  release(engine: IEngine): Promise<void>;
  getAvailableCount(): number;
  getStatus(): EnginePoolStatus;
}

// ============================================
// User Interaction Types
// ============================================

export interface UserResponse {
  action: string;
  message?: string;
  data?: Record<string, unknown>;
}

export interface ApprovalResponse {
  approved: boolean;
  adjustments?: PlanAdjustment[];
  reason?: string;
}

export interface WaitOptions {
  timeoutMs?: number;
  prompt?: string;
  actions?: string[];
}

export interface IUserInterface {
  notifyUser(message: string, data?: Record<string, unknown>): void;
  waitForResponse(options: WaitOptions): Promise<UserResponse>;
  requestApproval(
    plan: ScrumMasterPlan,
    riskLevel: RiskLevel,
    knowledgeCheck: KnowledgeCheckResult
  ): Promise<ApprovalResponse>;
  promptForAction(prompt: string, actions: string[]): Promise<string>;
}

// ============================================
// Scrum Master Event Types
// ============================================

export enum ScrumMasterEventType {
  TASK_RECEIVED = 'SM_TASK_RECEIVED',
  PLAN_STARTED = 'SM_PLAN_STARTED',
  PLAN_GENERATED = 'SM_PLAN_GENERATED',
  KNOWLEDGE_CHECKED = 'SM_KNOWLEDGE_CHECKED',
  RISK_ASSESSED = 'SM_RISK_ASSESSED',
  APPROVAL_REQUESTED = 'SM_APPROVAL_REQUESTED',
  APPROVAL_AUTO = 'SM_APPROVAL_AUTO',
  APPROVAL_GRANTED = 'SM_APPROVAL_GRANTED',
  APPROVAL_DENIED = 'SM_APPROVAL_DENIED',
  IMPLEMENTATION_STARTED = 'SM_IMPLEMENTATION_STARTED',
  IMPLEMENTATION_PROGRESS = 'SM_IMPLEMENTATION_PROGRESS',
  IMPLEMENTATION_COMPLETED = 'SM_IMPLEMENTATION_COMPLETED',
  IMPLEMENTATION_FAILED = 'SM_IMPLEMENTATION_FAILED',
  REVIEW_STARTED = 'SM_REVIEW_STARTED',
  REVIEW_PASSED = 'SM_REVIEW_PASSED',
  REVIEW_FAILED = 'SM_REVIEW_FAILED',
  PLAN_ADJUSTED = 'SM_PLAN_ADJUSTED',
  LEARNING_CAPTURED = 'SM_LEARNING_CAPTURED',
  ALERT_SENT = 'SM_ALERT_SENT',
  ALERT_ACKNOWLEDGED = 'SM_ALERT_ACKNOWLEDGED',
  BLOCKER_DETECTED = 'SM_BLOCKER_DETECTED',
  BLOCKER_RESOLVED = 'SM_BLOCKER_RESOLVED',
  TASK_BLOCKED = 'SM_TASK_BLOCKED',
  TASK_ESCALATED = 'SM_TASK_ESCALATED',
  TASK_COMPLETED = 'SM_TASK_COMPLETED',
  TASK_CANCELLED = 'SM_TASK_CANCELLED',
  TASK_FAILED = 'SM_TASK_FAILED',
  STATE_TRANSITION = 'SM_STATE_TRANSITION',
  ERROR_OCCURRED = 'SM_ERROR_OCCURRED',
}

export interface ScrumMasterEvent {
  id: string;
  type: ScrumMasterEventType;
  timestamp: Date;
  taskId?: string;
  state?: ScrumMasterState;
  data: Record<string, unknown>;
}

// ============================================
// Service Interfaces
// ============================================

/**
 * Main Scrum Master interface
 */
export interface IScrumMaster {
  /** Begin task supervision */
  startSession(task: Task): Promise<TaskResult>;

  /** Track agent progress */
  monitorProgress(): TaskLoopContext;

  /** Respond to agent blockers */
  handleBlocker(blocker: Blocker): Promise<void>;

  /** Review agent work */
  reviewOutput(output: ImplementationResult): Promise<ReviewResult>;

  /** Approval decisions */
  approveOrReject(decision: ApprovalDecision, reason?: string): Promise<void>;

  /** Record learnings */
  captureLearning(outcome: LearningCapture): Promise<void>;

  /** Get current state */
  getState(): ScrumMasterState;

  /** Get current context */
  getContext(): TaskLoopContext | undefined;

  /** Pause execution */
  pause(): Promise<void>;

  /** Resume execution */
  resume(): Promise<void>;

  /** Cancel task */
  cancel(reason: string): Promise<void>;
}

/**
 * Task supervisor interface
 */
export interface ITaskSupervisor {
  /** Start monitoring a task */
  startMonitoring(context: TaskLoopContext): void;

  /** Stop monitoring */
  stopMonitoring(): void;

  /** Check for stalls */
  checkForStall(): boolean;

  /** Get detected blockers */
  getBlockers(): Blocker[];

  /** Resolve a blocker */
  resolveBlocker(blockerId: string, resolution: string): void;

  /** Check if escalation is needed */
  shouldEscalate(): boolean;

  /** Get timeout status */
  getTimeoutStatus(): { timedOut: boolean; elapsedMs: number; remainingMs: number };
}

/**
 * Approval workflow interface
 */
export interface IApprovalWorkflow {
  /** Request approval for a plan */
  requestApproval(
    plan: ScrumMasterPlan,
    riskAssessment: RiskAssessment,
    knowledgeCheck: KnowledgeCheckResult
  ): Promise<ApprovalRequest>;

  /** Auto-approve if eligible */
  tryAutoApprove(
    plan: ScrumMasterPlan,
    riskAssessment: RiskAssessment
  ): ApprovalStatus | null;

  /** Handle human approval response */
  handleApprovalResponse(
    requestId: string,
    response: ApprovalResponse
  ): Promise<ApprovalStatus>;

  /** Get pending requests */
  getPendingRequests(): ApprovalRequest[];
}

/**
 * Learning capture interface
 */
export interface ILearningCapture {
  /** Extract learnings from task outcome */
  extractLearnings(context: TaskLoopContext): Promise<LearningCapture[]>;

  /** Submit learning to knowledge base */
  submitLearning(learning: LearningCapture): Promise<void>;

  /** Detect success patterns */
  detectSuccessPatterns(context: TaskLoopContext): Promise<string[]>;

  /** Detect failure patterns */
  detectFailurePatterns(context: TaskLoopContext): Promise<string[]>;
}

/**
 * Agent coordinator interface
 */
export interface IAgentCoordinator {
  /** Get available agents */
  getAvailableAgents(): AgentInfo[];

  /** Assign agent to task */
  assignAgent(taskId: string, agentType: AgentType): Promise<AgentAssignment>;

  /** Release agent from task */
  releaseAgent(agentId: string): Promise<void>;

  /** Check cost budget */
  checkCostBudget(projectId: string, estimatedCost: number): Promise<LimitCheckResult>;

  /** Record cost usage */
  recordCostUsage(usage: Partial<UsageRecord>): Promise<void>;
}

/**
 * Alert manager interface
 */
export interface IAlertManager {
  /** Send an alert */
  send(alert: Omit<Alert, 'id' | 'createdAt' | 'acknowledged'>): Promise<Alert>;

  /** Get active alerts */
  getActiveAlerts(taskId?: string): Alert[];

  /** Acknowledge an alert */
  acknowledge(alertId: string, acknowledgedBy: string): Promise<void>;
}

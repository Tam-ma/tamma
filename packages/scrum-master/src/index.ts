/**
 * @tamma/scrum-master
 *
 * Scrum Master Task Loop for the Tamma platform.
 * Coordinates task assignment, planning, approval, implementation,
 * review, and learning capture.
 */

// Main service
export {
  ScrumMasterService,
  createScrumMasterService,
} from './scrum-master-service.js';

// Types
export {
  // States
  ScrumMasterState,
  ScrumMasterEventType,

  // Task types
  type Task,
  type TaskType,
  type TaskPriority,
  type TaskResult,
  type TaskError,
  type TaskLoopContext,

  // Plan types
  type ScrumMasterPlan,
  type PlannedFileChange,

  // Approval types
  type ApprovalDecision,
  type ApprovalRequest,
  type ApprovalResponse,
  type ApprovalStatus,
  type PlanAdjustment,

  // Risk types
  type RiskLevel,
  type RiskAssessment,
  type RiskFactor,

  // Review types
  type ReviewResult,
  type ReviewIssue,
  type ReviewIssueSeverity,
  type ReviewIssueCategory,
  type QualityCheck,

  // Implementation types
  type ImplementationResult,

  // Learning types
  type LearningCapture,

  // Blocker types
  type Blocker,
  type BlockerType,

  // Alert types
  type Alert,
  type AlertType,
  type AlertSeverity,

  // Agent types
  type AgentInfo,
  type AgentAssignment,

  // Engine types
  type IEngine,
  type IEnginePool,
  type EnginePoolStatus,
  type EngineExecutionConfig,
  type EngineProgressEvent,

  // User interaction types
  type IUserInterface,
  type UserResponse,
  type WaitOptions,

  // Event types
  type ScrumMasterEvent,

  // Service interfaces
  type IScrumMaster,
  type ITaskSupervisor,
  type IApprovalWorkflow,
  type ILearningCapture,
  type IAgentCoordinator,
  type IAlertManager,
} from './types.js';

// Configuration
export {
  type ScrumMasterConfig,
  type TaskLoopConfig,
  type RiskThresholdConfig,
  type RiskThreshold,
  type LearningCaptureConfig,
  type AlertConfig,
  type AlertChannel,
  type AlertChannelType,
  type UserInteractionConfig,
  type CostConfig,
  type EscalationConfig,
  DEFAULT_SCRUM_MASTER_CONFIG,
  mergeConfig,
  getRiskLevelFromConfig,
} from './config.js';

// Services
export {
  TaskSupervisor,
  createTaskSupervisor,
  ApprovalWorkflow,
  createApprovalWorkflow,
  LearningCaptureService,
  createLearningCapture,
  AlertManager,
  AlertSender,
  createAlertManager,
} from './services/index.js';

// Coordinators
export {
  AgentCoordinator,
  AgentPool,
  MockEngine,
  MockEnginePool,
  createAgentCoordinator,
} from './coordinators/index.js';

// Errors
export {
  ScrumMasterError,
  InvalidStateTransitionError,
  TaskBlockedError,
  ApprovalDeniedError,
  MaxRetriesExceededError,
  TaskTimeoutError,
  CostLimitExceededError,
  ImplementationFailedError,
  ReviewFailedError,
  NoEngineAvailableError,
  PermissionDeniedError,
  TaskCancelledError,
  EscalationRequiredError,
} from './errors.js';

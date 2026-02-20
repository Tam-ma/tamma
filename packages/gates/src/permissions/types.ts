/**
 * Permission types and interfaces for the Agent Permissions System
 * @module @tamma/gates/permissions/types
 */

// ============================================
// Permission Categories & Actions
// ============================================

export type PermissionCategory =
  | 'tool' // Claude Code tools (Read, Write, Edit, Bash, etc.)
  | 'file' // File system access
  | 'command' // Shell commands
  | 'api' // External APIs
  | 'git' // Git operations
  | 'resource'; // Resource limits

export type PermissionAction = 'allow' | 'deny' | 'require_approval';

export type PermissionScope = 'global' | 'project';

// ============================================
// Agent Types
// ============================================

export type AgentType =
  | 'scrum_master'
  | 'architect'
  | 'researcher'
  | 'analyst'
  | 'planner'
  | 'implementer'
  | 'reviewer'
  | 'tester'
  | 'documenter';

// ============================================
// Core Permission Interface
// ============================================

export interface Permission {
  id: string;
  category: PermissionCategory;
  resource: string; // Tool name, path pattern, command, etc.
  action: PermissionAction;
  conditions?: PermissionCondition[];
}

export interface PermissionCondition {
  type: 'pattern' | 'limit' | 'time' | 'context';
  value: unknown;
}

// ============================================
// Tool Permissions
// ============================================

export interface ToolPermissions {
  allowed: string[]; // ['Read', 'Glob', 'Grep']
  denied: string[]; // ['Bash', 'Write']
  requireApproval: string[]; // ['Edit']
}

// ============================================
// File Permissions
// ============================================

export interface FilePermissions {
  read: {
    allowed: string[]; // Glob patterns: ['**/*']
    denied: string[]; // ['**/.env', '**/secrets/**']
  };
  write: {
    allowed: string[]; // ['src/**/*.ts', 'tests/**/*.ts']
    denied: string[]; // ['package.json', 'tsconfig.json']
  };
}

// ============================================
// Command Permissions
// ============================================

export interface CommandPermissions {
  allowed: string[]; // ['npm test', 'npm run lint']
  denied: string[]; // ['rm -rf', 'sudo *']
  patterns: {
    allow: string[]; // Regex patterns as strings
    deny: string[];
  };
}

// ============================================
// API Permissions
// ============================================

export interface APIPermissions {
  allowed: string[]; // ['https://api.github.com/*']
  denied: string[]; // ['*://internal.company.com/*']
  requireApproval: string[];
}

// ============================================
// Git Permissions
// ============================================

export type GitOperation =
  | 'commit'
  | 'push'
  | 'create_branch'
  | 'delete_branch'
  | 'merge'
  | 'rebase'
  | 'force_push';

export interface GitPermissions {
  canCommit: boolean;
  canPush: boolean;
  canCreateBranch: boolean;
  canMerge: boolean;
  canDeleteBranch: boolean;
  canRebase: boolean;
  canForcePush: boolean;
  protectedBranches: string[]; // Cannot modify: ['main', 'master', 'release/*']
}

// ============================================
// Resource Limits
// ============================================

export interface ResourceLimits {
  maxTokensPerTask: number;
  maxBudgetPerTask: number; // USD
  maxDurationMinutes: number;
  maxFilesModified: number;
  maxLinesChanged: number;
  maxConcurrentTasks: number;
}

// ============================================
// Full Permission Set
// ============================================

export interface AgentPermissionSet {
  agentType: AgentType;
  scope: PermissionScope;
  scopeId?: string; // Project ID if scope is 'project'

  tools: ToolPermissions;
  files: FilePermissions;
  commands: CommandPermissions;
  apis: APIPermissions;
  git: GitPermissions;
  resources: ResourceLimits;

  // Metadata
  createdAt?: Date;
  updatedAt?: Date;
  createdBy?: string;
}

// ============================================
// Permission Check Result
// ============================================

export interface PermissionResult {
  allowed: boolean;
  reason?: string;
  requiresApproval?: boolean;
  suggestedAlternative?: string;
  matchedRule?: Permission;
}

// ============================================
// Agent Action Types
// ============================================

export type AgentActionType =
  | 'tool'
  | 'file_read'
  | 'file_write'
  | 'command'
  | 'git'
  | 'api';

export interface AgentAction {
  type: AgentActionType;
  toolName?: string;
  path?: string;
  command?: string;
  operation?: GitOperation;
  apiUrl?: string;
  metadata?: Record<string, unknown>;
}

// ============================================
// Permission Request (for elevated perms)
// ============================================

export interface PermissionRequest {
  id: string;
  agentType: AgentType;
  projectId: string;
  taskId: string;
  requestedPermission: Permission;
  reason: string;
  duration?: number; // Temporary grant duration in minutes
  status: 'pending' | 'approved' | 'denied' | 'expired';
  requestedAt: Date;
  resolvedAt?: Date;
  resolvedBy?: string;
  resolutionReason?: string;
}

export interface PermissionRequestResult {
  approved: boolean;
  requestId: string;
  expiresAt?: Date;
  reason?: string;
}

// ============================================
// Permission Violation
// ============================================

export interface PermissionViolation {
  id: string;
  agentType: AgentType;
  projectId: string;
  taskId?: string;
  action: AgentAction;
  deniedPermission: Permission;
  reason: string;
  timestamp: Date;
  severity: 'low' | 'medium' | 'high' | 'critical';
  repeated: boolean;
  repeatCount?: number;
}

export interface ViolationFilter {
  agentType?: AgentType;
  projectId?: string;
  fromDate?: Date;
  toDate?: Date;
  severity?: string[];
  limit?: number;
}

// ============================================
// Permission Service Interface
// ============================================

export interface IPermissionService {
  // Check permissions
  checkToolPermission(
    agentType: AgentType,
    projectId: string,
    tool: string,
  ): PermissionResult;

  checkFilePermission(
    agentType: AgentType,
    projectId: string,
    path: string,
    action: 'read' | 'write',
  ): PermissionResult;

  checkCommandPermission(
    agentType: AgentType,
    projectId: string,
    command: string,
  ): PermissionResult;

  checkGitPermission(
    agentType: AgentType,
    projectId: string,
    operation: GitOperation,
    branch?: string,
  ): PermissionResult;

  checkAPIPermission(
    agentType: AgentType,
    projectId: string,
    url: string,
  ): PermissionResult;

  checkResourceLimit(
    agentType: AgentType,
    projectId: string,
    resource: keyof ResourceLimits,
    value: number,
  ): PermissionResult;

  // Get effective permissions (global + project overrides)
  getEffectivePermissions(
    agentType: AgentType,
    projectId: string,
  ): AgentPermissionSet;

  // Management
  setGlobalPermissions(
    agentType: AgentType,
    permissions: Partial<AgentPermissionSet>,
  ): Promise<void>;

  setProjectPermissions(
    projectId: string,
    agentType: AgentType,
    permissions: Partial<AgentPermissionSet>,
  ): Promise<void>;

  getGlobalPermissions(agentType: AgentType): AgentPermissionSet | undefined;

  getProjectPermissions(
    projectId: string,
    agentType: AgentType,
  ): Partial<AgentPermissionSet> | undefined;

  // Permission requests
  requestPermission(
    request: Omit<PermissionRequest, 'id' | 'status' | 'requestedAt'>,
  ): Promise<PermissionRequestResult>;
  approvePermissionRequest(requestId: string, approver: string): Promise<void>;
  denyPermissionRequest(
    requestId: string,
    approver: string,
    reason: string,
  ): Promise<void>;
  getPendingRequests(projectId?: string): Promise<PermissionRequest[]>;

  // Audit
  getPermissionViolations(
    filter?: ViolationFilter,
  ): Promise<PermissionViolation[]>;
  recordViolation(
    violation: Omit<PermissionViolation, 'id' | 'timestamp'>,
  ): Promise<void>;
}

// ============================================
// Permission Enforcer Interface
// ============================================

export interface IPermissionEnforcer {
  enforcePermission(
    agentType: AgentType,
    projectId: string,
    action: AgentAction,
  ): Promise<void>;

  enforceResourceLimits(
    agentType: AgentType,
    projectId: string,
    currentUsage: Partial<ResourceLimits>,
  ): void;
}

// ============================================
// Permission Resolver Interface
// ============================================

export interface IPermissionResolver {
  resolve(agentType: AgentType, projectId: string): AgentPermissionSet;

  mergePermissions(
    global: AgentPermissionSet,
    projectOverrides: Partial<AgentPermissionSet>,
  ): AgentPermissionSet;
}

// ============================================
// Violation Recorder Interface
// ============================================

export interface IViolationRecorder {
  record(
    violation: Omit<
      PermissionViolation,
      'id' | 'timestamp' | 'repeated' | 'repeatCount'
    >,
  ): Promise<PermissionViolation>;
  getViolations(filter?: ViolationFilter): Promise<PermissionViolation[]>;
  getViolationCount(
    agentType: AgentType,
    projectId: string,
    hours?: number,
  ): Promise<number>;
}

// ============================================
// Violation Alerter Interface
// ============================================

export interface IViolationAlerter {
  checkAndAlert(violation: PermissionViolation): Promise<void>;
  setThreshold(
    agentType: AgentType,
    threshold: number,
    windowHours: number,
  ): void;
}

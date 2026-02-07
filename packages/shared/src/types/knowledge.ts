/**
 * Knowledge Base Types
 *
 * Types and interfaces for the Agent Knowledge Base system.
 * Stores recommendations, prohibited actions, and learnings for agents.
 */

// === Knowledge Entry Types ===

/**
 * Types of knowledge entries
 */
export type KnowledgeType = 'recommendation' | 'prohibition' | 'learning';

/**
 * Scope of knowledge applicability
 */
export type KnowledgeScope = 'global' | 'project' | 'agent_type';

/**
 * Source of knowledge entry
 */
export type KnowledgeSource =
  | 'manual'
  | 'task_success'
  | 'task_failure'
  | 'code_review'
  | 'import';

/**
 * Priority level for knowledge entries
 */
export type KnowledgePriority = 'low' | 'medium' | 'high' | 'critical';

/**
 * Agent types that can use knowledge
 */
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

/**
 * Example demonstrating knowledge application
 */
export interface KnowledgeExample {
  /** The scenario this example addresses */
  scenario: string;
  /** The recommended approach */
  goodApproach?: string;
  /** The approach to avoid */
  badApproach?: string;
  /** Outcome of following/not following the knowledge */
  outcome?: string;
}

/**
 * A knowledge entry in the knowledge base
 */
export interface KnowledgeEntry {
  /** Unique identifier */
  id: string;
  /** Type of knowledge */
  type: KnowledgeType;

  // Content
  /** Short title */
  title: string;
  /** Description of the knowledge */
  description: string;
  /** Detailed information */
  details?: string;
  /** Examples demonstrating the knowledge */
  examples?: KnowledgeExample[];

  // Scope
  /** Scope of applicability */
  scope: KnowledgeScope;
  /** Project ID (if scope is 'project') */
  projectId?: string;
  /** Agent types this applies to (if scope is 'agent_type' or as additional filter) */
  agentTypes?: AgentType[];

  // Matching
  /** Keywords for matching */
  keywords: string[];
  /** Regex patterns for matching (e.g., file paths) */
  patterns?: string[];
  /** Embedding vector for semantic search */
  embedding?: number[];

  // Metadata
  /** Priority level */
  priority: KnowledgePriority;
  /** Source of the knowledge */
  source: KnowledgeSource;
  /** Reference to source (e.g., PR number, task ID) */
  sourceRef?: string;
  /** Creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
  /** User who created this entry */
  createdBy: string;
  /** Start of validity period */
  validFrom?: Date;
  /** End of validity period */
  validUntil?: Date;
  /** Whether this entry is active */
  enabled: boolean;

  // Stats
  /** Number of times this knowledge was applied */
  timesApplied: number;
  /** Number of times users reported it was helpful */
  timesHelpful: number;
  /** Last time this knowledge was applied */
  lastApplied?: Date;
}

// === Query Types ===

/**
 * Query parameters for retrieving relevant knowledge
 */
export interface KnowledgeQuery {
  /** Type of task being performed */
  taskType: string;
  /** Description of the task */
  taskDescription: string;
  /** Project identifier */
  projectId: string;
  /** Type of agent querying */
  agentType: AgentType;
  /** File paths involved in the task */
  filePaths?: string[];
  /** Technologies involved */
  technologies?: string[];
  /** Types of knowledge to retrieve */
  types?: KnowledgeType[];
  /** Maximum results per type */
  maxResults?: number;
  /** Minimum priority to include */
  minPriority?: KnowledgePriority;
}

/**
 * Result of a knowledge query
 */
export interface KnowledgeResult {
  /** Relevant recommendations */
  recommendations: KnowledgeEntry[];
  /** Relevant prohibitions */
  prohibitions: KnowledgeEntry[];
  /** Relevant learnings */
  learnings: KnowledgeEntry[];
  /** Token-efficient summary for agent consumption */
  summary: string;
  /** Critical warnings that must be addressed */
  criticalWarnings: string[];
}

/**
 * Filter for listing knowledge entries
 */
export interface KnowledgeFilter {
  /** Filter by types */
  types?: KnowledgeType[];
  /** Filter by scopes */
  scopes?: KnowledgeScope[];
  /** Filter by project ID */
  projectId?: string;
  /** Filter by agent types */
  agentTypes?: AgentType[];
  /** Filter by source */
  source?: KnowledgeSource;
  /** Filter by enabled status */
  enabled?: boolean;
  /** Filter by priority */
  priority?: KnowledgePriority;
  /** Text search query */
  search?: string;
  /** Maximum results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

// === Check Result Types ===

/**
 * A matched knowledge entry with match details
 */
export interface KnowledgeMatch {
  /** The matched knowledge entry */
  knowledge: KnowledgeEntry;
  /** Reason for the match */
  matchReason: string;
  /** Match score (0-1) */
  matchScore: number;
  /** Applicability score (0-1) */
  applicability?: number;
}

/**
 * Result of pre-task knowledge check
 */
export interface KnowledgeCheckResult {
  /** Whether the task can proceed */
  canProceed: boolean;
  /** Recommendations for the task */
  recommendations: KnowledgeMatch[];
  /** Warnings (non-blocking) */
  warnings: KnowledgeMatch[];
  /** Blockers (prevent task execution) */
  blockers: KnowledgeMatch[];
  /** Relevant learnings from past tasks */
  learnings: KnowledgeMatch[];
}

// === Learning Capture Types ===

/**
 * Data for capturing a learning from task outcome
 */
export interface LearningCapture {
  /** ID of the completed task */
  taskId: string;
  /** Project the task was in */
  projectId: string;
  /** Outcome of the task */
  outcome: 'success' | 'failure' | 'partial';
  /** Description of what happened */
  description: string;
  /** What worked well */
  whatWorked?: string;
  /** What failed or caused issues */
  whatFailed?: string;
  /** Root cause analysis */
  rootCause?: string;
  /** Suggested title for the learning */
  suggestedTitle: string;
  /** Suggested description */
  suggestedDescription: string;
  /** Suggested keywords */
  suggestedKeywords: string[];
  /** Suggested priority */
  suggestedPriority: KnowledgePriority;
}

/**
 * A pending learning awaiting approval
 */
export interface PendingLearning extends LearningCapture {
  /** Unique identifier */
  id: string;
  /** When the learning was captured */
  capturedAt: Date;
  /** Who/what captured the learning */
  capturedBy: string;
  /** Current status */
  status: 'pending' | 'approved' | 'rejected';
  /** When the learning was reviewed */
  reviewedAt?: Date;
  /** Who reviewed the learning */
  reviewedBy?: string;
  /** Reason for rejection (if rejected) */
  rejectionReason?: string;
}

/**
 * Filter for pending learnings
 */
export interface PendingLearningFilter {
  /** Filter by status */
  status?: 'pending' | 'approved' | 'rejected';
  /** Filter by project */
  projectId?: string;
  /** Filter by outcome */
  outcome?: 'success' | 'failure' | 'partial';
  /** Maximum results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

// === Import/Export Types ===

/**
 * Result of importing knowledge entries
 */
export interface KnowledgeImportResult {
  /** Number of successfully imported entries */
  imported: number;
  /** Number of skipped entries (e.g., duplicates) */
  skipped: number;
  /** Errors encountered during import */
  errors: Array<{ entry: Partial<KnowledgeEntry>; error: string }>;
}

// === CRUD Types ===

/**
 * Data for creating a new knowledge entry
 */
export type CreateKnowledgeEntry = Omit<
  KnowledgeEntry,
  'id' | 'createdAt' | 'updatedAt' | 'timesApplied' | 'timesHelpful' | 'lastApplied'
>;

/**
 * Data for updating a knowledge entry
 */
export type UpdateKnowledgeEntry = Partial<
  Omit<KnowledgeEntry, 'id' | 'createdAt' | 'updatedAt'>
>;

/**
 * Result of listing knowledge entries
 */
export interface KnowledgeListResult {
  /** The entries */
  entries: KnowledgeEntry[];
  /** Total count (for pagination) */
  total: number;
  /** Whether there are more results */
  hasMore: boolean;
}

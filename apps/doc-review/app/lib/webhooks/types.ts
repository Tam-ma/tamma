/**
 * Webhook Event Types and Interfaces
 *
 * Defines the structure for webhook events from GitHub, GitLab, and other providers
 */

// ============================================================================
// Base Types
// ============================================================================

export type WebhookProvider = 'github' | 'gitlab' | 'bitbucket';
export type WebhookEventStatus = 'pending' | 'processed' | 'failed';
export type WebhookDeliveryStatus = 'pending' | 'success' | 'failed' | 'timeout';

// ============================================================================
// Database Models
// ============================================================================

export interface WebhookEvent {
  id: string;
  provider: WebhookProvider;
  eventType: string;
  eventAction?: string;
  payload: string; // JSON string
  signature?: string;
  headers?: string; // JSON string
  processed: 0 | 1 | -1; // 0 = unprocessed, 1 = processed, -1 = failed
  processedAt?: number;
  error?: string;
  retryCount: number;
  prNumber?: number;
  branch?: string;
  repository?: string;
  senderUsername?: string;
  createdAt: number;
  ipAddress?: string;
  userAgent?: string;
}

export interface WebhookConfiguration {
  id: string;
  provider: WebhookProvider;
  webhookUrl: string;
  secret: string; // Encrypted
  events: string; // JSON array
  active: 0 | 1;
  lastDeliveryAt?: number;
  lastDeliveryStatus?: string;
  failureCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface WebhookDelivery {
  id: string;
  eventId: string;
  status: WebhookDeliveryStatus;
  responseStatus?: number;
  responseBody?: string;
  durationMs?: number;
  attemptNumber: number;
  createdAt: number;
}

// ============================================================================
// GitHub Webhook Types
// ============================================================================

export interface GitHubWebhookHeaders {
  'x-github-event': string;
  'x-github-delivery': string;
  'x-hub-signature-256': string;
  'x-github-hook-id'?: string;
  'x-github-hook-installation-target-id'?: string;
  'x-github-hook-installation-target-type'?: string;
}

export interface GitHubUser {
  id: number;
  login: string;
  avatar_url?: string;
  html_url?: string;
  type?: string;
}

export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  owner: GitHubUser;
  private: boolean;
  html_url: string;
  default_branch: string;
}

export interface GitHubPullRequest {
  id: number;
  number: number;
  title: string;
  body?: string;
  state: 'open' | 'closed';
  draft: boolean;
  merged: boolean;
  mergeable?: boolean;
  html_url: string;
  user: GitHubUser;
  head: {
    ref: string;
    sha: string;
    repo?: GitHubRepository;
  };
  base: {
    ref: string;
    sha: string;
    repo?: GitHubRepository;
  };
  created_at: string;
  updated_at: string;
  closed_at?: string;
  merged_at?: string;
}

export interface GitHubReview {
  id: number;
  user: GitHubUser;
  body?: string;
  state: 'PENDING' | 'COMMENTED' | 'APPROVED' | 'CHANGES_REQUESTED' | 'DISMISSED';
  html_url: string;
  submitted_at?: string;
  commit_id: string;
}

export interface GitHubComment {
  id: number;
  body: string;
  user: GitHubUser;
  created_at: string;
  updated_at: string;
  html_url: string;
  issue_url?: string;
  pull_request_url?: string;
}

export interface GitHubPullRequestEvent {
  action: 'opened' | 'closed' | 'reopened' | 'edited' | 'synchronize' | 'ready_for_review' | 'converted_to_draft';
  number: number;
  pull_request: GitHubPullRequest;
  repository: GitHubRepository;
  sender: GitHubUser;
}

export interface GitHubPullRequestReviewEvent {
  action: 'submitted' | 'edited' | 'dismissed';
  review: GitHubReview;
  pull_request: GitHubPullRequest;
  repository: GitHubRepository;
  sender: GitHubUser;
}

export interface GitHubIssueCommentEvent {
  action: 'created' | 'edited' | 'deleted';
  comment: GitHubComment;
  issue?: {
    number: number;
    title: string;
    pull_request?: {
      url: string;
    };
  };
  repository: GitHubRepository;
  sender: GitHubUser;
}

export interface GitHubPushEvent {
  ref: string;
  before: string;
  after: string;
  commits: Array<{
    id: string;
    message: string;
    timestamp: string;
    author: {
      name: string;
      email: string;
    };
    added: string[];
    removed: string[];
    modified: string[];
  }>;
  repository: GitHubRepository;
  pusher: {
    name: string;
    email?: string;
  };
  sender: GitHubUser;
}

// ============================================================================
// GitLab Webhook Types
// ============================================================================

export interface GitLabWebhookHeaders {
  'x-gitlab-event': string;
  'x-gitlab-token': string;
  'x-gitlab-event-uuid'?: string;
  'x-gitlab-instance'?: string;
}

export interface GitLabUser {
  id: number;
  username: string;
  name?: string;
  avatar_url?: string;
  email?: string;
}

export interface GitLabProject {
  id: number;
  name: string;
  namespace: string;
  path_with_namespace: string;
  web_url: string;
  default_branch: string;
  visibility: string;
}

export interface GitLabMergeRequest {
  id: number;
  iid: number; // Internal ID (like GitHub's number)
  title: string;
  description?: string;
  state: 'opened' | 'closed' | 'merged' | 'locked';
  draft: boolean;
  work_in_progress: boolean;
  merge_status: string;
  web_url: string;
  author: GitLabUser;
  source_branch: string;
  target_branch: string;
  created_at: string;
  updated_at: string;
  merged_at?: string;
}

export interface GitLabMergeRequestEvent {
  object_kind: 'merge_request';
  event_type: 'merge_request';
  user: GitLabUser;
  project: GitLabProject;
  object_attributes: GitLabMergeRequest & {
    action?: 'open' | 'close' | 'reopen' | 'update' | 'approved' | 'unapproved' | 'approval' | 'unapproval' | 'merge';
  };
}

export interface GitLabNoteEvent {
  object_kind: 'note';
  event_type: 'note';
  user: GitLabUser;
  project: GitLabProject;
  object_attributes: {
    id: number;
    note: string;
    noteable_type: 'MergeRequest' | 'Issue' | 'Commit';
    noteable_id: number;
    created_at: string;
    updated_at: string;
    url: string;
  };
  merge_request?: GitLabMergeRequest;
}

export interface GitLabPushEvent {
  object_kind: 'push';
  event_name: 'push';
  before: string;
  after: string;
  ref: string;
  checkout_sha: string;
  user_id: number;
  user_name: string;
  user_username: string;
  user_email: string;
  user_avatar?: string;
  project: GitLabProject;
  commits: Array<{
    id: string;
    message: string;
    timestamp: string;
    author: {
      name: string;
      email: string;
    };
    added: string[];
    modified: string[];
    removed: string[];
  }>;
  total_commits_count: number;
}

// ============================================================================
// Unified Webhook Event Types
// ============================================================================

export type UnifiedWebhookEventType =
  | 'pull_request.opened'
  | 'pull_request.closed'
  | 'pull_request.merged'
  | 'pull_request.updated'
  | 'review.submitted'
  | 'review.edited'
  | 'comment.created'
  | 'comment.edited'
  | 'comment.deleted'
  | 'push.commits';

export interface UnifiedWebhookEvent {
  provider: WebhookProvider;
  type: UnifiedWebhookEventType;
  timestamp: string;
  data: UnifiedEventData;
  raw: unknown; // Original webhook payload
}

export type UnifiedEventData =
  | UnifiedPullRequestData
  | UnifiedReviewData
  | UnifiedCommentData
  | UnifiedPushData;

export interface UnifiedPullRequestData {
  kind: 'pull_request';
  action: 'opened' | 'closed' | 'merged' | 'updated';
  prNumber: number;
  title: string;
  description?: string;
  state: 'open' | 'closed' | 'merged';
  draft: boolean;
  branch: string;
  baseBranch: string;
  url: string;
  author: {
    id: string;
    username: string;
    avatarUrl?: string;
  };
  createdAt: string;
  updatedAt: string;
  mergedAt?: string;
}

export interface UnifiedReviewData {
  kind: 'review';
  action: 'submitted' | 'edited';
  prNumber: number;
  reviewId: string;
  state: 'pending' | 'commented' | 'approved' | 'changes_requested';
  body?: string;
  author: {
    id: string;
    username: string;
    avatarUrl?: string;
  };
  createdAt: string;
}

export interface UnifiedCommentData {
  kind: 'comment';
  action: 'created' | 'edited' | 'deleted';
  prNumber?: number;
  commentId: string;
  body: string;
  author: {
    id: string;
    username: string;
    avatarUrl?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface UnifiedPushData {
  kind: 'push';
  branch: string;
  commits: Array<{
    id: string;
    message: string;
    author: string;
    timestamp: string;
    filesChanged: {
      added: string[];
      modified: string[];
      removed: string[];
    };
  }>;
}

// ============================================================================
// Webhook Processing Types
// ============================================================================

export interface WebhookProcessingResult {
  success: boolean;
  message?: string;
  error?: string;
  actions?: string[]; // List of actions taken
}

export interface WebhookVerificationResult {
  valid: boolean;
  provider: WebhookProvider;
  eventType?: string;
  error?: string;
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface WebhookSecrets {
  github?: string;
  gitlab?: string;
  bitbucket?: string;
}

export interface WebhookEndpoints {
  github: string;
  gitlab: string;
  bitbucket?: string;
}

export interface WebhookSubscriptions {
  github: string[];
  gitlab: string[];
  bitbucket?: string[];
}

// Default subscriptions for each provider
export const DEFAULT_GITHUB_EVENTS = [
  'pull_request',
  'pull_request_review',
  'issue_comment',
  'push'
];

export const DEFAULT_GITLAB_EVENTS = [
  'merge_request',
  'note',
  'push'
];

// ============================================================================
// Rate Limiting Types
// ============================================================================

export interface WebhookRateLimitInfo {
  provider: WebhookProvider;
  limit: number; // Max requests per window
  window: number; // Window in seconds
  remaining: number;
  resetAt: number; // Unix timestamp
}

// ============================================================================
// Admin UI Types
// ============================================================================

export interface WebhookStats {
  provider: WebhookProvider;
  total: number;
  processed: number;
  failed: number;
  pending: number;
  lastReceived?: string;
  lastProcessed?: string;
}

export interface WebhookTestResult {
  success: boolean;
  statusCode?: number;
  headers?: Record<string, string>;
  body?: string;
  error?: string;
  duration: number;
}
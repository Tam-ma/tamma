import type { Repository, Branch, Issue, PullRequest, Comment, CIStatus, CommitInfo } from '../types/models.js';

// ---------------------------------------------------------------------------
// Lightweight interfaces for GitHub API response shapes.
// Only the fields actually accessed by the mapper functions are declared.
// ---------------------------------------------------------------------------

export interface GitHubRepoResponse {
  owner: { login: string };
  name: string;
  full_name: string;
  default_branch: string;
  html_url: string;
  private: boolean;
}

export interface GitHubBranchResponse {
  object?: { sha: string };
  commit?: { sha: string };
  protected?: boolean;
}

export interface GitHubLabelResponse {
  name?: string;
}

export interface GitHubUserResponse {
  login: string;
}

export interface GitHubIssueResponse {
  number: number;
  title: string;
  body?: string | null;
  state: string;
  labels: Array<string | GitHubLabelResponse>;
  assignees?: GitHubUserResponse[] | null;
  html_url: string;
  created_at: string;
  updated_at: string;
}

export interface GitHubCommentResponse {
  id: number;
  user: { login: string } | null;
  body?: string | null;
  created_at: string;
}

export interface GitHubPRResponse {
  number: number;
  title: string;
  body: string | null;
  state: string;
  merged: boolean;
  head: { ref: string };
  base: { ref: string };
  html_url: string;
  mergeable: boolean | null;
  labels: Array<string | GitHubLabelResponse>;
  created_at: string;
  updated_at: string;
}

export interface GitHubCommitResponse {
  sha: string;
  commit: {
    message: string;
    author: { name?: string; date?: string } | null;
  };
}

export interface GitHubCombinedStatusResponse {
  statuses?: Array<{ state: string }>;
}

export interface GitHubCheckRunsResponse {
  check_runs?: Array<{ conclusion: string | null; status: string }>;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

export function mapRepository(data: GitHubRepoResponse): Repository {
  return {
    owner: data.owner.login,
    name: data.name,
    fullName: data.full_name,
    defaultBranch: data.default_branch,
    url: data.html_url,
    isPrivate: data.private,
  };
}

export function mapBranch(data: GitHubBranchResponse, branchName: string): Branch {
  const sha = data.object?.sha ?? data.commit?.sha;
  if (sha === undefined) {
    throw new Error(
      `Malformed branch response for '${branchName}': missing both object.sha and commit.sha`,
    );
  }
  return {
    name: branchName,
    sha,
    isProtected: data.protected ?? false,
  };
}

export function mapIssue(data: GitHubIssueResponse, comments: Comment[] = []): Issue {
  return {
    number: data.number,
    title: data.title,
    body: data.body ?? '',
    state: data.state as 'open' | 'closed',
    labels: (data.labels ?? []).map((l: string | GitHubLabelResponse) =>
      typeof l === 'string' ? l : (l.name ?? ''),
    ),
    assignees: (data.assignees ?? []).map((a: GitHubUserResponse) => a.login),
    url: data.html_url,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    comments,
  };
}

export function mapComment(data: GitHubCommentResponse): Comment {
  return {
    id: data.id,
    author: data.user?.login ?? 'unknown',
    body: data.body ?? '',
    createdAt: data.created_at,
  };
}

export function mapPullRequest(data: GitHubPRResponse): PullRequest {
  return {
    number: data.number,
    title: data.title,
    body: data.body ?? '',
    state: data.merged === true ? 'merged' : (data.state as 'open' | 'closed'),
    head: data.head.ref,
    base: data.base.ref,
    url: data.html_url,
    mergeable: data.mergeable ?? null,
    labels: (data.labels ?? []).map((l: string | GitHubLabelResponse) =>
      typeof l === 'string' ? l : (l.name ?? ''),
    ),
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

export function mapCommit(data: GitHubCommitResponse): CommitInfo {
  return {
    sha: data.sha,
    message: data.commit.message,
    author: data.commit.author?.name ?? 'unknown',
    date: data.commit.author?.date ?? '',
  };
}

export function mapCIStatus(
  combinedStatus: GitHubCombinedStatusResponse,
  checkRuns: GitHubCheckRunsResponse,
): CIStatus {
  const statuses: Array<{ state: string }> = combinedStatus.statuses ?? [];
  const checks: Array<{ conclusion: string | null; status: string }> =
    checkRuns.check_runs ?? [];

  const allItems = [
    ...statuses.map((s) => normalizeState(s.state)),
    ...checks.map((c) =>
      c.status === 'completed'
        ? normalizeConclusion(c.conclusion)
        : ('pending' as const),
    ),
  ];

  const totalCount = allItems.length;
  const successCount = allItems.filter((s) => s === 'success').length;
  const failureCount = allItems.filter(
    (s) => s === 'failure' || s === 'error',
  ).length;
  const pendingCount = allItems.filter((s) => s === 'pending').length;

  let state: CIStatus['state'];
  if (totalCount === 0) {
    state = 'success';
  } else if (failureCount > 0) {
    state = 'failure';
  } else if (pendingCount > 0) {
    state = 'pending';
  } else {
    state = 'success';
  }

  return { state, totalCount, successCount, failureCount, pendingCount };
}

function normalizeState(state: string): 'pending' | 'success' | 'failure' | 'error' {
  switch (state) {
    case 'success':
      return 'success';
    case 'failure':
      return 'failure';
    case 'error':
      return 'error';
    default:
      return 'pending';
  }
}

function normalizeConclusion(
  conclusion: string | null,
): 'pending' | 'success' | 'failure' | 'error' {
  switch (conclusion) {
    case 'success':
    case 'skipped':
    case 'neutral':
      return 'success';
    case 'failure':
    case 'timed_out':
    case 'cancelled':
      return 'failure';
    case 'action_required':
      return 'error';
    default:
      return 'pending';
  }
}

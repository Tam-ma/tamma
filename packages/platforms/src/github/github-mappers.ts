import type { Repository, Branch, Issue, PullRequest, Comment, CIStatus, CommitInfo } from '../types/models.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

export function mapRepository(data: any): Repository {
  return {
    owner: data.owner.login,
    name: data.name,
    fullName: data.full_name,
    defaultBranch: data.default_branch,
    url: data.html_url,
    isPrivate: data.private,
  };
}

export function mapBranch(data: any, branchName: string): Branch {
  return {
    name: branchName,
    sha: data.object?.sha ?? data.commit?.sha ?? '',
    isProtected: data.protected ?? false,
  };
}

export function mapIssue(data: any, comments: Comment[] = []): Issue {
  return {
    number: data.number,
    title: data.title,
    body: data.body ?? '',
    state: data.state as 'open' | 'closed',
    labels: (data.labels ?? []).map((l: any) =>
      typeof l === 'string' ? l : l.name,
    ),
    assignees: (data.assignees ?? []).map((a: any) => a.login),
    url: data.html_url,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    comments,
  };
}

export function mapComment(data: any): Comment {
  return {
    id: data.id,
    author: data.user?.login ?? 'unknown',
    body: data.body ?? '',
    createdAt: data.created_at,
  };
}

export function mapPullRequest(data: any): PullRequest {
  return {
    number: data.number,
    title: data.title,
    body: data.body ?? '',
    state: data.merged === true ? 'merged' : (data.state as 'open' | 'closed'),
    head: data.head.ref,
    base: data.base.ref,
    url: data.html_url,
    mergeable: data.mergeable ?? null,
    labels: (data.labels ?? []).map((l: any) =>
      typeof l === 'string' ? l : l.name,
    ),
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

export function mapCommit(data: any): CommitInfo {
  return {
    sha: data.sha,
    message: data.commit.message,
    author: data.commit.author?.name ?? 'unknown',
    date: data.commit.author?.date ?? '',
  };
}

export function mapCIStatus(
  combinedStatus: any,
  checkRuns: any,
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

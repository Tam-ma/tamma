export interface Repository {
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  url: string;
  isPrivate: boolean;
}

export interface Branch {
  name: string;
  sha: string;
  isProtected: boolean;
}

export interface Issue {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  labels: string[];
  assignees: string[];
  url: string;
  createdAt: string;
  updatedAt: string;
  comments: Comment[];
}

export interface Comment {
  id: number;
  author: string;
  body: string;
  createdAt: string;
}

export interface PullRequest {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed' | 'merged';
  head: string;
  base: string;
  url: string;
  mergeable: boolean | null;
  labels: string[];
  createdAt: string;
  updatedAt: string;
}

export type CIStatusState = 'pending' | 'success' | 'failure' | 'error';

export interface CIStatus {
  state: CIStatusState;
  totalCount: number;
  successCount: number;
  failureCount: number;
  pendingCount: number;
}

export interface MergeResult {
  merged: boolean;
  sha: string;
  message: string;
}

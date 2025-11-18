export interface GitPullRequestMeta {
  branch: string;
  prNumber: number;
  prUrl: string;
  status: 'draft' | 'open' | 'merged' | 'closed';
}

export interface GitReviewComment {
  id: string;
  body: string;
  author: {
    id: string;
    username: string;
    avatarUrl?: string;
  };
  createdAt: number;
  filePath?: string;
  line?: number;
}

export interface GitProvider {
  ensureSessionPullRequest(input: {
    sessionId: string;
    title: string;
    summary?: string | null;
    docPaths: string[];
  }): Promise<GitPullRequestMeta>;

  appendSuggestionPatch(input: {
    sessionId: string;
    docPath: string;
    diff: string;
  }): Promise<{ status: 'queued' | 'committed'; branch: string }>;

  listPullRequestComments(sessionId: string): Promise<GitReviewComment[]>;
}

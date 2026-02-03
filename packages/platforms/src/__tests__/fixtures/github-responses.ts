/* eslint-disable @typescript-eslint/no-explicit-any */

export const mockRepoResponse: any = {
  owner: { login: 'test-owner' },
  name: 'test-repo',
  full_name: 'test-owner/test-repo',
  default_branch: 'main',
  html_url: 'https://github.com/test-owner/test-repo',
  private: false,
};

export const mockRefResponse: any = {
  ref: 'refs/heads/main',
  object: { sha: 'abc123', type: 'commit' },
};

export const mockIssueResponse: any = {
  number: 42,
  title: 'Fix authentication bug',
  body: 'The login flow fails when...',
  state: 'open',
  labels: [{ name: 'bug' }, { name: 'tamma' }],
  assignees: [],
  html_url: 'https://github.com/test-owner/test-repo/issues/42',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
};

export const mockCommentResponse: any = {
  id: 1,
  user: { login: 'reviewer' },
  body: 'This is related to #10',
  created_at: '2024-01-01T12:00:00Z',
};

export const mockPullRequestResponse: any = {
  number: 99,
  title: 'Fix auth bug',
  body: 'Closes #42',
  state: 'open',
  merged: false,
  head: { ref: 'feature/42-fix-auth-bug' },
  base: { ref: 'main' },
  html_url: 'https://github.com/test-owner/test-repo/pull/99',
  mergeable: true,
  labels: [{ name: 'tamma-automated' }],
  created_at: '2024-01-03T00:00:00Z',
  updated_at: '2024-01-03T00:00:00Z',
};

export const mockCombinedStatusResponse: any = {
  state: 'success',
  statuses: [
    { state: 'success', context: 'ci/test' },
  ],
};

export const mockCheckRunsResponse: any = {
  total_count: 1,
  check_runs: [
    { status: 'completed', conclusion: 'success', name: 'build' },
  ],
};

export const mockMergeResponse: any = {
  merged: true,
  sha: 'merge-sha-123',
  message: 'Pull Request successfully merged',
};

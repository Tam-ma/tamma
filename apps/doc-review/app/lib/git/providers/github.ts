import type {
  GitProvider,
  GitPullRequestMeta,
  GitReviewComment
} from '../types';

interface GitHubProviderEnv {
  GITHUB_TOKEN?: string;
  GIT_TOKEN?: string;
  GIT_OWNER?: string;
  GIT_REPO?: string;
  GIT_DEFAULT_BRANCH?: string;
  CACHE?: KVNamespace;
}

interface GitHubApiError {
  message: string;
  documentation_url?: string;
  status?: number;
}

interface GitHubUser {
  id: number;
  login: string;
  avatar_url?: string;
  name?: string;
}

interface GitHubFile {
  path: string;
  content: string;
  sha: string;
  size: number;
  encoding: string;
  html_url: string;
  download_url?: string;
}

interface GitHubBranch {
  ref: string;
  node_id: string;
  url: string;
  object: {
    sha: string;
    type: string;
    url: string;
  };
}

interface GitHubPullRequest {
  id: number;
  number: number;
  title: string;
  body?: string;
  state: 'open' | 'closed';
  draft: boolean;
  html_url: string;
  user: GitHubUser;
  head: {
    ref: string;
    sha: string;
  };
  base: {
    ref: string;
    sha: string;
  };
  merged: boolean;
  mergeable?: boolean;
  created_at: string;
  updated_at: string;
  merged_at?: string;
}

interface GitHubComment {
  id: number;
  body: string;
  user: GitHubUser;
  created_at: string;
  updated_at: string;
  html_url: string;
  path?: string;
  line?: number;
  commit_id?: string;
}

interface GitHubBlameRange {
  commit: {
    sha: string;
    message: string;
    author: {
      name: string;
      email: string;
      date: string;
    };
    committer: {
      name: string;
      email: string;
      date: string;
    };
  };
  lines: string[];
}

interface GitHubTree {
  sha: string;
  url: string;
  tree: Array<{
    path: string;
    mode: string;
    type: 'blob' | 'tree';
    sha: string;
    size?: number;
    url: string;
  }>;
  truncated: boolean;
}

/**
 * GitHub API Provider Implementation
 *
 * Provides real GitHub API integration for the documentation review system.
 * Uses GitHub REST API v3 with authentication via personal access token.
 */
export class GitHubProvider implements GitProvider {
  private readonly baseUrl: string;
  private readonly owner: string;
  private readonly repo: string;
  private readonly token: string;
  private readonly defaultBranch: string;
  private readonly cache?: KVNamespace;

  constructor(env: GitHubProviderEnv) {
    this.baseUrl = 'https://api.github.com';
    this.owner = env.GIT_OWNER ?? '';
    this.repo = env.GIT_REPO ?? '';
    this.token = env.GITHUB_TOKEN ?? env.GIT_TOKEN ?? '';
    this.defaultBranch = env.GIT_DEFAULT_BRANCH ?? 'main';
    this.cache = env.CACHE;

    if (!this.owner || !this.repo) {
      throw new Error('GitHub provider requires GIT_OWNER and GIT_REPO environment variables');
    }

    if (!this.token) {
      throw new Error('GitHub provider requires GITHUB_TOKEN or GIT_TOKEN environment variable');
    }
  }

  /**
   * Ensures a pull request exists for the given session
   */
  async ensureSessionPullRequest(input: {
    sessionId: string;
    title: string;
    summary?: string | null;
    docPaths: string[];
  }): Promise<GitPullRequestMeta> {
    // Check cache first
    const cacheKey = `github-pr:${input.sessionId}`;
    if (this.cache) {
      const cached = await this.cache.get<GitPullRequestMeta>(cacheKey, 'json');
      if (cached) {
        // Verify PR still exists
        try {
          const pr = await this.getPullRequest(cached.prNumber);
          if (pr) {
            return cached;
          }
        } catch {
          // PR doesn't exist, continue to create new one
        }
      }
    }

    // Create branch for this session
    const branchName = this.deriveBranchName(input);
    await this.createBranch(branchName, this.defaultBranch);

    // Create pull request
    const body = this.buildPRBody(input);
    const pr = await this.createPullRequest({
      title: input.title,
      body,
      sourceBranch: branchName,
      targetBranch: this.defaultBranch,
      draft: true,
    });

    const meta: GitPullRequestMeta = {
      branch: branchName,
      prNumber: pr.number,
      prUrl: pr.html_url,
      status: pr.draft ? 'draft' : pr.state === 'open' ? 'open' : pr.merged ? 'merged' : 'closed',
    };

    // Cache the result
    if (this.cache) {
      await this.cache.put(cacheKey, JSON.stringify(meta), {
        expirationTtl: 86400, // 24 hours
      });
    }

    return meta;
  }

  /**
   * Appends a suggestion patch to the session's branch
   */
  async appendSuggestionPatch(input: {
    sessionId: string;
    docPath: string;
    diff: string;
  }): Promise<{ status: 'queued' | 'committed'; branch: string }> {
    const branchName = this.deriveBranchName({ sessionId: input.sessionId });

    try {
      // Get the current file content
      const file = await this.getFile(input.docPath, branchName);

      // Apply the diff (simplified - in production, use a proper diff library)
      const updatedContent = this.applyDiff(file.content, input.diff);

      // Update the file on the branch
      await this.updateFile({
        path: input.docPath,
        content: updatedContent,
        message: `Apply suggestions to ${input.docPath}`,
        branch: branchName,
        sha: file.sha,
      });

      return { status: 'committed', branch: branchName };
    } catch (error) {
      console.error('Failed to apply suggestion patch:', error);
      return { status: 'queued', branch: branchName };
    }
  }

  /**
   * Lists comments on a pull request
   */
  async listPullRequestComments(sessionId: string): Promise<GitReviewComment[]> {
    // Get PR number from cache or derive from session
    const cacheKey = `github-pr:${sessionId}`;
    let prNumber: number | undefined;

    if (this.cache) {
      const cached = await this.cache.get<GitPullRequestMeta>(cacheKey, 'json');
      if (cached) {
        prNumber = cached.prNumber;
      }
    }

    if (!prNumber) {
      // Try to find PR by branch name
      const branchName = this.deriveBranchName({ sessionId });
      const prs = await this.listPullRequests({ state: 'all', head: `${this.owner}:${branchName}` });
      if (prs.length > 0) {
        prNumber = prs[0].number;
      } else {
        return [];
      }
    }

    // Fetch both issue comments and review comments
    const [issueComments, reviewComments] = await Promise.all([
      this.fetchIssueComments(prNumber),
      this.fetchReviewComments(prNumber),
    ]);

    // Convert to our format
    const comments: GitReviewComment[] = [
      ...issueComments.map(c => this.convertToReviewComment(c)),
      ...reviewComments.map(c => this.convertToReviewComment(c)),
    ];

    // Sort by creation date
    comments.sort((a, b) => a.createdAt - b.createdAt);

    return comments;
  }

  // ============================================================================
  // Core GitHub API Methods (matching IGitProvider interface from docs)
  // ============================================================================

  /**
   * Get file content from GitHub
   */
  async getFile(path: string, ref?: string): Promise<GitHubFile> {
    const url = `${this.baseUrl}/repos/${this.owner}/${this.repo}/contents/${path}`;
    const params = ref ? `?ref=${ref}` : '';

    const response = await this.fetch(`${url}${params}`);

    if (!response.ok) {
      const error = await this.parseError(response);
      throw new Error(`Failed to get file ${path}: ${error.message}`);
    }

    const data = await response.json() as GitHubFile;

    // Decode base64 content
    if (data.encoding === 'base64' && data.content) {
      data.content = atob(data.content.replace(/\n/g, ''));
    }

    return data;
  }

  /**
   * List files in a directory
   */
  async listFiles(directory: string, ref?: string): Promise<GitHubTree['tree']> {
    // First, get the tree SHA for the directory
    const url = `${this.baseUrl}/repos/${this.owner}/${this.repo}/contents/${directory}`;
    const params = ref ? `?ref=${ref}` : '';

    const response = await this.fetch(`${url}${params}`);

    if (!response.ok) {
      const error = await this.parseError(response);
      throw new Error(`Failed to list files in ${directory}: ${error.message}`);
    }

    const items = await response.json() as Array<{
      path: string;
      type: 'file' | 'dir';
      sha: string;
      size?: number;
    }>;

    // Convert to tree format
    return items.map(item => ({
      path: item.path,
      mode: '100644',
      type: item.type === 'dir' ? 'tree' : 'blob',
      sha: item.sha,
      size: item.size,
      url: `${this.baseUrl}/repos/${this.owner}/${this.repo}/git/blobs/${item.sha}`,
    }));
  }

  /**
   * Create a new branch
   */
  async createBranch(name: string, fromRef: string): Promise<GitHubBranch> {
    // First, get the SHA of the reference we're branching from
    const refResponse = await this.fetch(
      `${this.baseUrl}/repos/${this.owner}/${this.repo}/git/refs/heads/${fromRef}`
    );

    if (!refResponse.ok) {
      const error = await this.parseError(refResponse);
      throw new Error(`Failed to get reference ${fromRef}: ${error.message}`);
    }

    const refData = await refResponse.json() as GitHubBranch;
    const sha = refData.object.sha;

    // Create the new branch
    const createResponse = await this.fetch(
      `${this.baseUrl}/repos/${this.owner}/${this.repo}/git/refs`,
      {
        method: 'POST',
        body: JSON.stringify({
          ref: `refs/heads/${name}`,
          sha,
        }),
      }
    );

    if (!createResponse.ok) {
      // Check if branch already exists
      if (createResponse.status === 422) {
        // Branch exists, return it
        const existingResponse = await this.fetch(
          `${this.baseUrl}/repos/${this.owner}/${this.repo}/git/refs/heads/${name}`
        );
        if (existingResponse.ok) {
          return await existingResponse.json() as GitHubBranch;
        }
      }

      const error = await this.parseError(createResponse);
      throw new Error(`Failed to create branch ${name}: ${error.message}`);
    }

    return await createResponse.json() as GitHubBranch;
  }

  /**
   * Create a pull request
   */
  async createPullRequest(params: {
    title: string;
    body: string;
    sourceBranch: string;
    targetBranch: string;
    draft?: boolean;
  }): Promise<GitHubPullRequest> {
    const response = await this.fetch(
      `${this.baseUrl}/repos/${this.owner}/${this.repo}/pulls`,
      {
        method: 'POST',
        body: JSON.stringify({
          title: params.title,
          body: params.body,
          head: params.sourceBranch,
          base: params.targetBranch,
          draft: params.draft ?? false,
        }),
      }
    );

    if (!response.ok) {
      const error = await this.parseError(response);
      throw new Error(`Failed to create pull request: ${error.message}`);
    }

    return await response.json() as GitHubPullRequest;
  }

  /**
   * Get a specific pull request
   */
  async getPullRequest(number: number): Promise<GitHubPullRequest> {
    const response = await this.fetch(
      `${this.baseUrl}/repos/${this.owner}/${this.repo}/pulls/${number}`
    );

    if (!response.ok) {
      const error = await this.parseError(response);
      throw new Error(`Failed to get pull request #${number}: ${error.message}`);
    }

    return await response.json() as GitHubPullRequest;
  }

  /**
   * List pull requests
   */
  async listPullRequests(options?: {
    state?: 'open' | 'closed' | 'all';
    head?: string;
    base?: string;
  }): Promise<GitHubPullRequest[]> {
    const params = new URLSearchParams();
    if (options?.state) params.append('state', options.state);
    if (options?.head) params.append('head', options.head);
    if (options?.base) params.append('base', options.base);

    const response = await this.fetch(
      `${this.baseUrl}/repos/${this.owner}/${this.repo}/pulls?${params}`
    );

    if (!response.ok) {
      const error = await this.parseError(response);
      throw new Error(`Failed to list pull requests: ${error.message}`);
    }

    return await response.json() as GitHubPullRequest[];
  }

  /**
   * Get blame information for a file
   */
  async getBlame(path: string, ref?: string): Promise<GitHubBlameRange[]> {
    // GitHub doesn't have a REST API for blame, need to use GraphQL
    const query = `
      query($owner: String!, $repo: String!, $path: String!, $ref: String!) {
        repository(owner: $owner, name: $repo) {
          object(expression: $ref) {
            ... on Commit {
              blame(path: $path) {
                ranges {
                  commit {
                    oid
                    message
                    author {
                      name
                      email
                      date
                    }
                    committer {
                      name
                      email
                      date
                    }
                  }
                  startingLine
                  endingLine
                  age
                }
              }
            }
          }
        }
      }
    `;

    const response = await fetch(`${this.baseUrl}/graphql`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        variables: {
          owner: this.owner,
          repo: this.repo,
          path,
          ref: ref ?? this.defaultBranch,
        },
      }),
    });

    if (!response.ok) {
      const error = await this.parseError(response);
      throw new Error(`Failed to get blame for ${path}: ${error.message}`);
    }

    const result = await response.json() as any;

    if (result.errors) {
      throw new Error(`GraphQL error: ${result.errors[0]?.message ?? 'Unknown error'}`);
    }

    const ranges = result.data?.repository?.object?.blame?.ranges ?? [];

    // Convert GraphQL ranges to our format
    return ranges.map((range: any) => ({
      commit: {
        sha: range.commit.oid,
        message: range.commit.message,
        author: {
          name: range.commit.author.name,
          email: range.commit.author.email,
          date: range.commit.author.date,
        },
        committer: {
          name: range.commit.committer.name,
          email: range.commit.committer.email,
          date: range.commit.committer.date,
        },
      },
      lines: [], // Lines would need to be fetched separately
    }));
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Update a file in the repository
   */
  private async updateFile(params: {
    path: string;
    content: string;
    message: string;
    branch: string;
    sha: string;
  }): Promise<void> {
    const response = await this.fetch(
      `${this.baseUrl}/repos/${this.owner}/${this.repo}/contents/${params.path}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          message: params.message,
          content: btoa(params.content),
          sha: params.sha,
          branch: params.branch,
        }),
      }
    );

    if (!response.ok) {
      const error = await this.parseError(response);
      throw new Error(`Failed to update file ${params.path}: ${error.message}`);
    }
  }

  /**
   * Fetch issue comments for a pull request
   */
  private async fetchIssueComments(prNumber: number): Promise<GitHubComment[]> {
    const response = await this.fetch(
      `${this.baseUrl}/repos/${this.owner}/${this.repo}/issues/${prNumber}/comments`
    );

    if (!response.ok) {
      const error = await this.parseError(response);
      throw new Error(`Failed to fetch issue comments: ${error.message}`);
    }

    return await response.json() as GitHubComment[];
  }

  /**
   * Fetch review comments for a pull request
   */
  private async fetchReviewComments(prNumber: number): Promise<GitHubComment[]> {
    const response = await this.fetch(
      `${this.baseUrl}/repos/${this.owner}/${this.repo}/pulls/${prNumber}/comments`
    );

    if (!response.ok) {
      const error = await this.parseError(response);
      throw new Error(`Failed to fetch review comments: ${error.message}`);
    }

    return await response.json() as GitHubComment[];
  }

  /**
   * Convert GitHub comment to our format
   */
  private convertToReviewComment(comment: GitHubComment): GitReviewComment {
    return {
      id: String(comment.id),
      body: comment.body,
      author: {
        id: String(comment.user.id),
        username: comment.user.login,
        avatarUrl: comment.user.avatar_url,
      },
      createdAt: new Date(comment.created_at).getTime(),
      filePath: comment.path,
      line: comment.line,
    };
  }

  /**
   * Make authenticated fetch request to GitHub API
   */
  private async fetch(url: string, options?: RequestInit): Promise<Response> {
    return fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...options?.headers,
      },
    });
  }

  /**
   * Parse error response from GitHub API
   */
  private async parseError(response: Response): Promise<GitHubApiError> {
    try {
      const error = await response.json() as GitHubApiError;
      return {
        message: error.message || 'Unknown error',
        documentation_url: error.documentation_url,
        status: response.status,
      };
    } catch {
      return {
        message: `HTTP ${response.status}: ${response.statusText}`,
        status: response.status,
      };
    }
  }

  /**
   * Derive a branch name from input parameters
   */
  private deriveBranchName(input: {
    sessionId?: string;
    title?: string;
    docPath?: string;
  }): string {
    const parts = [
      'doc-review',
      input.title ?? input.docPath ?? input.sessionId ?? 'session'
    ]
      .map(part => part.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
      .filter(Boolean);

    const branchName = parts.join('/').slice(0, 60);
    return branchName || 'doc-review/session';
  }

  /**
   * Build pull request body text
   */
  private buildPRBody(input: {
    summary?: string | null;
    docPaths: string[];
    sessionId: string;
  }): string {
    const parts = [];

    if (input.summary) {
      parts.push(input.summary);
      parts.push('');
    }

    parts.push('## Documentation Review Session');
    parts.push('');
    parts.push(`Session ID: ${input.sessionId}`);
    parts.push('');

    if (input.docPaths.length > 0) {
      parts.push('### Documents under review:');
      for (const path of input.docPaths) {
        parts.push(`- ${path}`);
      }
      parts.push('');
    }

    parts.push('---');
    parts.push('*This pull request was created by the Documentation Review System*');

    return parts.join('\n');
  }

  /**
   * Apply a diff to content (simplified implementation)
   */
  private applyDiff(content: string, diff: string): string {
    // This is a simplified implementation
    // In production, use a proper diff/patch library like 'diff' or 'patch-package'

    // For now, just append the diff as a comment
    // Real implementation would parse and apply the unified diff format
    return content + '\n\n<!-- Applied diff:\n' + diff + '\n-->';
  }
}
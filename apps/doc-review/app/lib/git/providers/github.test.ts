import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GitHubProvider } from './github';

// Mock fetch globally
global.fetch = vi.fn();

describe('GitHubProvider', () => {
  let provider: GitHubProvider;
  const mockEnv = {
    GITHUB_TOKEN: 'test-token',
    GIT_OWNER: 'test-owner',
    GIT_REPO: 'test-repo',
    GIT_DEFAULT_BRANCH: 'main',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new GitHubProvider(mockEnv);
  });

  describe('constructor', () => {
    it('should throw error if owner is missing', () => {
      expect(() => new GitHubProvider({
        GITHUB_TOKEN: 'token',
        GIT_REPO: 'repo',
      })).toThrow('GitHub provider requires GIT_OWNER and GIT_REPO environment variables');
    });

    it('should throw error if repo is missing', () => {
      expect(() => new GitHubProvider({
        GITHUB_TOKEN: 'token',
        GIT_OWNER: 'owner',
      })).toThrow('GitHub provider requires GIT_OWNER and GIT_REPO environment variables');
    });

    it('should throw error if token is missing', () => {
      expect(() => new GitHubProvider({
        GIT_OWNER: 'owner',
        GIT_REPO: 'repo',
      })).toThrow('GitHub provider requires GITHUB_TOKEN or GIT_TOKEN environment variable');
    });

    it('should accept GIT_TOKEN as fallback', () => {
      expect(() => new GitHubProvider({
        GIT_TOKEN: 'token',
        GIT_OWNER: 'owner',
        GIT_REPO: 'repo',
      })).not.toThrow();
    });
  });

  describe('getFile', () => {
    it('should fetch file content from GitHub', async () => {
      const mockFile = {
        path: 'test.md',
        content: btoa('# Test Content'),
        sha: 'abc123',
        size: 100,
        encoding: 'base64',
        html_url: 'https://github.com/test/repo/blob/main/test.md',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockFile,
      });

      const result = await provider.getFile('test.md');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/test-owner/test-repo/contents/test.md',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token',
            'Accept': 'application/vnd.github.v3+json',
          }),
        })
      );

      expect(result.content).toBe('# Test Content');
      expect(result.sha).toBe('abc123');
      expect(result.path).toBe('test.md');
    });

    it('should fetch file from specific ref', async () => {
      const mockFile = {
        path: 'test.md',
        content: btoa('# Branch Content'),
        sha: 'def456',
        size: 100,
        encoding: 'base64',
        html_url: 'https://github.com/test/repo/blob/feature/test.md',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockFile,
      });

      const result = await provider.getFile('test.md', 'feature-branch');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/test-owner/test-repo/contents/test.md?ref=feature-branch',
        expect.anything()
      );

      expect(result.content).toBe('# Branch Content');
    });

    it('should throw error on API failure', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ message: 'Not Found' }),
      });

      await expect(provider.getFile('missing.md')).rejects.toThrow(
        'Failed to get file missing.md: Not Found'
      );
    });
  });

  describe('createBranch', () => {
    it('should create a new branch', async () => {
      // Mock getting the base ref
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ref: 'refs/heads/main',
          object: { sha: 'base-sha-123' },
        }),
      });

      // Mock creating the new branch
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ref: 'refs/heads/new-feature',
          object: { sha: 'base-sha-123' },
        }),
      });

      const result = await provider.createBranch('new-feature', 'main');

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(global.fetch).toHaveBeenNthCalledWith(1,
        'https://api.github.com/repos/test-owner/test-repo/git/refs/heads/main',
        expect.anything()
      );
      expect(global.fetch).toHaveBeenNthCalledWith(2,
        'https://api.github.com/repos/test-owner/test-repo/git/refs',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            ref: 'refs/heads/new-feature',
            sha: 'base-sha-123',
          }),
        })
      );

      expect(result.ref).toBe('refs/heads/new-feature');
    });

    it('should return existing branch if it already exists', async () => {
      // Mock getting the base ref
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ref: 'refs/heads/main',
          object: { sha: 'base-sha-123' },
        }),
      });

      // Mock branch already exists error
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: async () => ({ message: 'Reference already exists' }),
      });

      // Mock fetching existing branch
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ref: 'refs/heads/existing-branch',
          object: { sha: 'existing-sha-456' },
        }),
      });

      const result = await provider.createBranch('existing-branch', 'main');

      expect(result.ref).toBe('refs/heads/existing-branch');
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('createPullRequest', () => {
    it('should create a pull request', async () => {
      const mockPR = {
        id: 123,
        number: 42,
        title: 'Test PR',
        body: 'Test description',
        state: 'open',
        draft: true,
        html_url: 'https://github.com/test/repo/pull/42',
        user: {
          id: 1,
          login: 'testuser',
          avatar_url: 'https://avatars.githubusercontent.com/u/1',
        },
        head: { ref: 'feature-branch', sha: 'head-sha' },
        base: { ref: 'main', sha: 'base-sha' },
        merged: false,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockPR,
      });

      const result = await provider.createPullRequest({
        title: 'Test PR',
        body: 'Test description',
        sourceBranch: 'feature-branch',
        targetBranch: 'main',
        draft: true,
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/test-owner/test-repo/pulls',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            title: 'Test PR',
            body: 'Test description',
            head: 'feature-branch',
            base: 'main',
            draft: true,
          }),
        })
      );

      expect(result.number).toBe(42);
      expect(result.title).toBe('Test PR');
      expect(result.draft).toBe(true);
    });
  });

  describe('ensureSessionPullRequest', () => {
    it('should create PR for new session', async () => {
      // Mock branch creation
      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            ref: 'refs/heads/main',
            object: { sha: 'base-sha' },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            ref: 'refs/heads/doc-review/test-session',
            object: { sha: 'base-sha' },
          }),
        });

      // Mock PR creation
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 123,
          number: 42,
          title: 'Test Review',
          state: 'open',
          draft: true,
          html_url: 'https://github.com/test/repo/pull/42',
          user: { id: 1, login: 'bot' },
          head: { ref: 'doc-review/test-session', sha: 'head-sha' },
          base: { ref: 'main', sha: 'base-sha' },
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        }),
      });

      const result = await provider.ensureSessionPullRequest({
        sessionId: 'test-123',
        title: 'Test Review',
        summary: 'Review summary',
        docPaths: ['docs/test.md'],
      });

      expect(result.prNumber).toBe(42);
      expect(result.prUrl).toBe('https://github.com/test/repo/pull/42');
      expect(result.status).toBe('draft');
      expect(result.branch).toContain('doc-review');
    });

    it('should return cached PR if it exists', async () => {
      const mockCache = {
        get: vi.fn().mockResolvedValueOnce({
          branch: 'cached-branch',
          prNumber: 99,
          prUrl: 'https://github.com/test/repo/pull/99',
          status: 'open' as const,
        }),
        put: vi.fn(),
      };

      const providerWithCache = new GitHubProvider({
        ...mockEnv,
        CACHE: mockCache as any,
      });

      // Mock PR verification
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          number: 99,
          state: 'open',
        }),
      });

      const result = await providerWithCache.ensureSessionPullRequest({
        sessionId: 'cached-123',
        title: 'Cached Review',
        docPaths: [],
      });

      expect(mockCache.get).toHaveBeenCalledWith('github-pr:cached-123', 'json');
      expect(result.prNumber).toBe(99);
      expect(result.status).toBe('open');
    });
  });

  describe('listPullRequestComments', () => {
    it('should fetch and convert comments', async () => {
      const mockIssueComments = [
        {
          id: 1,
          body: 'Issue comment',
          user: {
            id: 100,
            login: 'user1',
            avatar_url: 'https://avatar1.com',
          },
          created_at: '2024-01-01T10:00:00Z',
        },
      ];

      const mockReviewComments = [
        {
          id: 2,
          body: 'Review comment',
          user: {
            id: 200,
            login: 'user2',
            avatar_url: 'https://avatar2.com',
          },
          created_at: '2024-01-01T11:00:00Z',
          path: 'test.md',
          line: 10,
        },
      ];

      // Mock finding PR by branch
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            number: 42,
            head: { ref: 'doc-review/session-123' },
          },
        ],
      });

      // Mock fetching issue comments
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockIssueComments,
      });

      // Mock fetching review comments
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockReviewComments,
      });

      const result = await provider.listPullRequestComments('session-123');

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: '1',
        body: 'Issue comment',
        author: {
          id: '100',
          username: 'user1',
        },
      });
      expect(result[1]).toMatchObject({
        id: '2',
        body: 'Review comment',
        filePath: 'test.md',
        line: 10,
      });
    });

    it('should return empty array if no PR found', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      const result = await provider.listPullRequestComments('no-pr-session');
      expect(result).toEqual([]);
    });
  });

  describe('appendSuggestionPatch', () => {
    it('should apply patch and commit to branch', async () => {
      // Mock getting file
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: btoa('Original content'),
          sha: 'file-sha',
          encoding: 'base64',
        }),
      });

      // Mock updating file
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      const result = await provider.appendSuggestionPatch({
        sessionId: 'test-123',
        docPath: 'test.md',
        diff: '--- a/test.md\n+++ b/test.md\n@@ -1 +1 @@\n-Original\n+Updated',
      });

      expect(result.status).toBe('committed');
      expect(result.branch).toContain('doc-review');

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(global.fetch).toHaveBeenNthCalledWith(2,
        expect.stringContaining('/contents/test.md'),
        expect.objectContaining({
          method: 'PUT',
        })
      );
    });

    it('should return queued status on error', async () => {
      (global.fetch as any).mockRejectedValueOnce(new Error('API Error'));

      const result = await provider.appendSuggestionPatch({
        sessionId: 'test-123',
        docPath: 'test.md',
        diff: 'some diff',
      });

      expect(result.status).toBe('queued');
    });
  });

  describe('getBlame', () => {
    it('should fetch blame information via GraphQL', async () => {
      const mockGraphQLResponse = {
        data: {
          repository: {
            object: {
              blame: {
                ranges: [
                  {
                    commit: {
                      oid: 'commit-sha-1',
                      message: 'Initial commit',
                      author: {
                        name: 'Author Name',
                        email: 'author@example.com',
                        date: '2024-01-01T00:00:00Z',
                      },
                      committer: {
                        name: 'Committer Name',
                        email: 'committer@example.com',
                        date: '2024-01-01T00:00:00Z',
                      },
                    },
                    startingLine: 1,
                    endingLine: 10,
                  },
                ],
              },
            },
          },
        },
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockGraphQLResponse,
      });

      const result = await provider.getBlame('test.md');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/graphql',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token',
            'Content-Type': 'application/json',
          }),
        })
      );

      expect(result).toHaveLength(1);
      expect(result[0].commit.sha).toBe('commit-sha-1');
      expect(result[0].commit.message).toBe('Initial commit');
    });

    it('should handle GraphQL errors', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          errors: [{ message: 'GraphQL error' }],
        }),
      });

      await expect(provider.getBlame('test.md')).rejects.toThrow(
        'GraphQL error: GraphQL error'
      );
    });
  });

  describe('listFiles', () => {
    it('should list files in directory', async () => {
      const mockFiles = [
        {
          path: 'docs/file1.md',
          type: 'file',
          sha: 'sha1',
          size: 100,
        },
        {
          path: 'docs/subfolder',
          type: 'dir',
          sha: 'sha2',
        },
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockFiles,
      });

      const result = await provider.listFiles('docs');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/test-owner/test-repo/contents/docs',
        expect.anything()
      );

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        path: 'docs/file1.md',
        type: 'blob',
        sha: 'sha1',
        size: 100,
      });
      expect(result[1]).toMatchObject({
        path: 'docs/subfolder',
        type: 'tree',
        sha: 'sha2',
      });
    });

    it('should list files from specific ref', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      await provider.listFiles('docs', 'feature-branch');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/test-owner/test-repo/contents/docs?ref=feature-branch',
        expect.anything()
      );
    });
  });
});
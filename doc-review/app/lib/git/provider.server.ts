import { GitProvider, GitPullRequestMeta, GitReviewComment } from './types';
import { GitHubProvider } from './providers/github';

interface ProviderEnv extends Record<string, unknown> {
  CACHE?: KVNamespace;
  GIT_PROVIDER?: string;
  GIT_OWNER?: string;
  GIT_REPO?: string;
  GIT_TOKEN?: string;
  GITHUB_TOKEN?: string;
}

export function getGitProvider(env: ProviderEnv): GitProvider {
  const mode = (env.GIT_PROVIDER ?? 'stub').toLowerCase();

  switch (mode) {
    case 'github':
      return new GitHubProvider({
        GITHUB_TOKEN: env.GITHUB_TOKEN,
        GIT_TOKEN: env.GIT_TOKEN,
        GIT_OWNER: env.GIT_OWNER,
        GIT_REPO: env.GIT_REPO,
        CACHE: env.CACHE,
      });

    case 'stub':
    default:
      return new StubGitProvider(env, mode);
  }
}

class StubGitProvider implements GitProvider {
  constructor(private env: ProviderEnv, _mode: string) {}

  async ensureSessionPullRequest(input: {
    sessionId: string;
    title: string;
    summary?: string | null;
    docPaths: string[];
  }): Promise<GitPullRequestMeta> {
    const key = `session-pr:${input.sessionId}`;
    const cached = await this.getCache().get<GitPullRequestMeta>(key, 'json');

    if (cached) {
      return cached;
    }

    const meta: GitPullRequestMeta = {
      branch: this.deriveBranchName(input),
      prNumber: this.buildStablePrNumber(input.sessionId),
      prUrl: `https://example.com/${this.env.GIT_OWNER ?? 'repo'}/${this.env.GIT_REPO ?? 'docs'}/pull/${this.buildStablePrNumber(input.sessionId)}`,
      status: 'draft',
    };

    await this.getCache().put(key, JSON.stringify(meta));
    return meta;
  }

  async appendSuggestionPatch(_input: { sessionId: string; docPath: string; diff: string }) {
    // Stub simply reports queued; real implementation would apply patch + push
    return { status: 'queued' as const, branch: this.deriveBranchName(_input) };
  }

  async listPullRequestComments(_sessionId: string): Promise<GitReviewComment[]> {
    // No-op stub; future: fetch from provider
    return [];
  }

  private deriveBranchName(input: { sessionId?: string; docPath?: string; title?: string }): string {
    const parts = [input.title ?? 'session', input.docPath ?? input.sessionId ?? 'docs']
      .map((part) => part?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') ?? 'docs')
      .filter(Boolean);
    return `session/${parts.join('-').slice(0, 40) || 'docs'}`;
  }

  private buildStablePrNumber(id: string): number {
    let hash = 0;
    for (let i = 0; i < id.length; i += 1) {
      hash = (hash << 5) - hash + id.charCodeAt(i);
      hash |= 0;
    }
    const positive = Math.abs(hash);
    return (positive % 9000) + 100;
  }

  private getCache() {
    if (this.env.CACHE) {
      return this.env.CACHE;
    }

    const store = new Map<string, string>();
    return {
      get: async (key: string, type?: 'json') => {
        const value = store.get(key) ?? null;
        if (type === 'json' && value) {
          try {
            return JSON.parse(value);
          } catch (error) {
            console.warn('Failed to parse stub cache value', error);
          }
        }
        return value;
      },
      put: async (key: string, value: string) => {
        store.set(key, value);
      },
    } as KVNamespace;
  }
}

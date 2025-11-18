import type { Document, DocumentMetadata, DocumentNavigation } from '~/lib/types/document';
import { readFile } from 'fs/promises';

type LoaderEnv = {
  CACHE?: KVNamespace;
  REPO_PATH?: string;
  DOCS_BASE_PATH?: string;
  GIT_PROVIDER?: string;
  GIT_OWNER?: string;
  GIT_REPO?: string;
  GIT_REF?: string;
  GITHUB_API_BASE?: string;
  GITHUB_TOKEN?: string;
  GIT_TOKEN?: string;
  [key: string]: unknown;
};

const DEFAULT_DOC_ROOT = 'docs';
const DEFAULT_GIT_REF = 'main';

function createMemoryKV(): KVNamespace {
  const store = new Map<string, string>();

  const kv = {
    get: async (key: string) => store.get(key) ?? null,
    getWithMetadata: async (key: string) => ({ value: store.get(key) ?? null, metadata: null }),
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    list: async () => ({ keys: [], list_complete: true }),
  };

  return kv as unknown as KVNamespace;
}

export class DocumentLoader {
  private cache: KVNamespace;

  constructor(private env: LoaderEnv) {
    const fallbackCache =
      typeof process !== 'undefined' && process.versions?.node ? createMemoryKV() : undefined;

    this.cache = env?.CACHE ?? fallbackCache!;

    if (!this.cache) {
      throw new Error('DocumentLoader requires a CACHE binding');
    }
  }

  /**
   * Load document from filesystem
   */
  async loadDocument(path: string): Promise<Document> {
    const repoPath = this.buildRepoPath(path);
    const cacheKey = this.buildCacheKey(repoPath);

    const cached = await this.cache.get(cacheKey);
    if (cached) {
      return this.parseDocument(path, cached);
    }

    const content = await this.readDocument(repoPath);
    const document = this.parseDocument(path, content);

    await this.cache.put(cacheKey, content, { expirationTtl: 60 });

    return document;
  }

  /**
   * Parse document content and extract metadata
   */
  private parseDocument(path: string, content: string): Document {
    const lines = content.split('\n');
    const headings = this.extractHeadings(content);

    // Extract title from first heading or filename
    const title = this.extractTitle(path, content, headings);
    const description = this.extractDescription(content);
    const category = this.categorizeDocument(path);

    return {
      path,
      title,
      description,
      content,
      category,
      epicId: this.extractEpicId(path),
      storyId: this.extractStoryId(path),
      wordCount: content.split(/\s+/).length,
      lineCount: lines.length,
      lastModified: Date.now(), // Would use Git file timestamp
      headings,
    };
  }

  /**
   * Extract headings from markdown content
   */
  private extractHeadings(content: string): Array<{ level: number; text: string; id: string }> {
    const headingRegex = /^(#{1,6})\s+(.+)$/gm;
    const headings: Array<{ level: number; text: string; id: string }> = [];
    let match;

    while ((match = headingRegex.exec(content)) !== null) {
      const level = match[1].length;
      const text = match[2].trim();
      const id = text
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-');

      headings.push({ level, text, id });
    }

    return headings;
  }

  /**
   * Extract title from document
   */
  private extractTitle(
    path: string,
    content: string,
    headings: Array<{ level: number; text: string }>
  ): string {
    // Try h1 heading first
    const h1Heading = headings.find((h) => h.level === 1);
    if (h1Heading) {
      return h1Heading.text;
    }

    // Try frontmatter title
    const frontmatterMatch = content.match(/^---\s*\n.*?title:\s*["']?(.+?)["']?\n.*?---/ms);
    if (frontmatterMatch) {
      return frontmatterMatch[1];
    }

    // Fallback to filename
    return (
      path
        .split('/')
        .pop()
        ?.replace(/\.(md|markdown)$/, '') || 'Untitled'
    );
  }

  /**
   * Extract description from frontmatter
   */
  private extractDescription(content: string): string | undefined {
    const frontmatterMatch = content.match(/^---\s*\n.*?description:\s*["']?(.+?)["']?\n.*?---/ms);
    return frontmatterMatch ? frontmatterMatch[1] : undefined;
  }

  /**
   * Categorize document based on path
   */
  private categorizeDocument(path: string): Document['category'] {
    if (path.includes('epics/') || path.includes('stories/')) {
      if (path.includes('stories/')) return 'story';
      return 'epic';
    }
    if (path.includes('research/')) return 'research';
    if (path.includes('retrospectives/')) return 'retrospective';
    return 'main';
  }

  /**
   * Extract epic ID from path
   */
  private extractEpicId(path: string): string | undefined {
    const epicMatch = path.match(/epics?\/([^\/]+)/);
    return epicMatch ? epicMatch[1] : undefined;
  }

  /**
   * Extract story ID from path
   */
  private extractStoryId(path: string): string | undefined {
    const storyMatch = path.match(/stories?\/([^\/\.]+)/);
    return storyMatch ? storyMatch[1] : undefined;
  }

  /**
   * Build cache key for a document path/ref combo
   */
  private buildCacheKey(path: string): string {
    const ref = (this.env.GIT_REF as string | undefined) ?? DEFAULT_GIT_REF;
    return `doc:${ref}:${path}`;
  }

  /**
   * Determine repo path for a document, ensuring docs root prefix
   */
  private buildRepoPath(relativePath: string): string {
    const docRoot =
      (this.env.DOCS_BASE_PATH as string | undefined) ?? process.env.DOCS_BASE_PATH ?? DEFAULT_DOC_ROOT;
    if (!docRoot) {
      return relativePath;
    }

    if (relativePath.startsWith(docRoot)) {
      return relativePath;
    }

    return `${docRoot.replace(/\/$/, '')}/${relativePath.replace(/^\//, '')}`;
  }

  /**
   * Load document source from either local filesystem or Git provider
   */
  private async readDocument(path: string): Promise<string> {
    if (this.canUseFileSystem()) {
      return this.readFromFileSystem(path);
    }

    return this.fetchFromGitProvider(path);
  }

  private canUseFileSystem(): boolean {
    return (
      typeof process !== 'undefined' &&
      !!process.versions?.node &&
      !!((this.env.REPO_PATH as string | undefined) ?? process.env.REPO_PATH)
    );
  }

  private async readFromFileSystem(path: string): Promise<string> {
    const repoRoot =
      (this.env.REPO_PATH as string | undefined) ??
      process.env.REPO_PATH ??
      `${process.cwd()}/${DEFAULT_DOC_ROOT}`;
    const normalizedRoot = repoRoot.replace(/\/$/, '');
    const fullPath = `${normalizedRoot}/${path}`;

    return await readFile(fullPath, 'utf-8');
  }

  private async fetchFromGitProvider(path: string): Promise<string> {
    const provider = (this.env.GIT_PROVIDER as string | undefined)?.toLowerCase() ?? 'github';
    if (provider !== 'github') {
      throw new Error(`Unsupported GIT_PROVIDER "${provider}" - only "github" is implemented`);
    }

    return this.fetchFromGitHub(path);
  }

  private async fetchFromGitHub(path: string): Promise<string> {
    const owner =
      (this.env.GIT_OWNER as string | undefined) ?? process.env.GIT_OWNER;
    const repo =
      (this.env.GIT_REPO as string | undefined) ?? process.env.GIT_REPO;

    if (!owner || !repo) {
      throw new Error('GIT_OWNER and GIT_REPO must be defined to fetch documentation from GitHub');
    }

    const apiBase =
      (this.env.GITHUB_API_BASE as string | undefined) ??
      process.env.GITHUB_API_BASE ??
      'https://api.github.com';
    const ref =
      (this.env.GIT_REF as string | undefined) ??
      process.env.GIT_REF ??
      DEFAULT_GIT_REF;
    const token =
      (this.env.GITHUB_TOKEN as string | undefined) ??
      (this.env.GIT_TOKEN as string | undefined) ??
      process.env.GITHUB_TOKEN ??
      process.env.GIT_TOKEN;

    const encodedPath = encodeURIComponent(path);
    const url = `${apiBase}/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(
      ref
    )}`;

    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3.raw',
      'User-Agent': 'tamma-doc-review',
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(url, { headers });

    if (!response.ok) {
      throw new Error(`GitHub response ${response.status} for ${path}`);
    }

    return await response.text();
  }

  /**
   * Get document navigation structure
   */
  async getNavigation(): Promise<DocumentNavigation> {
    // This would scan the repository structure
    // For now, return the documented structure
    return {
      main: [
        { id: 'prd', title: 'Product Requirements', path: 'PRD.md' },
        { id: 'architecture', title: 'Architecture', path: 'architecture.md' },
        { id: 'epics', title: 'Epics Overview', path: 'epics.md' },
      ],
      epics: [
        {
          id: 'epic-1',
          title: 'Epic 1: Foundation & Core Infrastructure',
          techSpec: 'tech-spec-epic-1.md',
          stories: [
            {
              id: '1-0',
              title: 'AI Provider Strategy Research',
              path: 'stories/1-0-ai-provider-strategy-research.md',
            },
            {
              id: '1-1',
              title: 'AI Provider Interface Definition',
              path: 'stories/1-1-ai-provider-interface-definition.md',
            },
            {
              id: '1-2',
              title: 'Anthropic Claude Provider Implementation',
              path: 'stories/1-2-anthropic-claude-provider-implementation.md',
            },
            {
              id: '1-3',
              title: 'Provider Configuration Management',
              path: 'stories/1-3-provider-configuration-management.md',
            },
            {
              id: '1-4',
              title: 'Git Platform Interface Definition',
              path: 'stories/1-4-git-platform-interface-definition.md',
            },
            {
              id: '1-5',
              title: 'GitHub Platform Implementation',
              path: 'stories/1-5-github-platform-implementation.md',
            },
            {
              id: '1-6',
              title: 'GitLab Platform Implementation',
              path: 'stories/1-6-gitlab-platform-implementation.md',
            },
            {
              id: '1-7',
              title: 'Git Platform Configuration Management',
              path: 'stories/1-7-git-platform-configuration-management.md',
            },
            {
              id: '1-8',
              title: 'Hybrid Orchestrator/Worker Architecture Design',
              path: 'stories/1-8-hybrid-orchestrator-worker-architecture-design.md',
            },
            {
              id: '1-9',
              title: 'Basic CLI Scaffolding',
              path: 'stories/1-9-basic-cli-scaffolding.md',
            },
            {
              id: '1-10',
              title: 'Additional AI Provider Implementations',
              path: 'stories/1-10-additional-ai-provider-implementations.md',
            },
            {
              id: '1-11',
              title: 'Additional Git Platform Implementations',
              path: 'stories/1-11-additional-git-platform-implementations.md',
            },
          ],
        },
        {
          id: 'epic-2',
          title: 'Epic 2: Autonomous Development Workflow',
          techSpec: 'tech-spec-epic-2.md',
          stories: [
            {
              id: '2-0',
              title: 'Workflow Engine Core Loop',
              path: 'stories/2-0-workflow-engine-core-loop.md',
            },
            {
              id: '2-1',
              title: 'Issue Assignment & Triage',
              path: 'stories/2-1-issue-assignment-triage.md',
            },
            {
              id: '2-2',
              title: 'AI Task Generation & Planning',
              path: 'stories/2-2-ai-task-generation-planning.md',
            },
            {
              id: '2-3',
              title: 'Code Generation Pipeline',
              path: 'stories/2-3-code-generation-pipeline.md',
            },
            {
              id: '2-4',
              title: 'Quality Gates Integration',
              path: 'stories/2-4-quality-gates-integration.md',
            },
            {
              id: '2-5',
              title: 'Pull Request Creation & Management',
              path: 'stories/2-5-pull-request-creation-management.md',
            },
            {
              id: '2-6',
              title: 'Build & Test Execution',
              path: 'stories/2-6-build-test-execution.md',
            },
            {
              id: '2-7',
              title: 'Deployment Pipeline Integration',
              path: 'stories/2-7-deployment-pipeline-integration.md',
            },
            {
              id: '2-8',
              title: 'Status Tracking & Reporting',
              path: 'stories/2-8-status-tracking-reporting.md',
            },
            {
              id: '2-9',
              title: 'Error Handling & Recovery',
              path: 'stories/2-9-error-handling-recovery.md',
            },
            {
              id: '2-10',
              title: 'Workflow Configuration Management',
              path: 'stories/2-10-workflow-configuration-management.md',
            },
            {
              id: '2-11',
              title: 'Workflow Monitoring & Analytics',
              path: 'stories/2-11-workflow-monitoring-analytics.md',
            },
          ],
        },
      ],
      research: [
        {
          id: 'ai-provider-strategy',
          title: 'AI Provider Strategy',
          path: 'research/ai-provider-strategy-2024-10.md',
        },
        {
          id: 'ai-provider-cost-analysis',
          title: 'AI Provider Cost Analysis',
          path: 'research/ai-provider-cost-analysis-2024-10.md',
        },
        {
          id: 'ai-provider-test-scenarios',
          title: 'AI Provider Test Scenarios',
          path: 'research/ai-provider-test-scenarios-2024-10.md',
        },
      ],
      retrospectives: [
        {
          id: 'epic-1-retro',
          title: 'Epic 1 Retrospective',
          path: 'retrospectives/epic-1-retro-2025-11-06.md',
        },
        {
          id: 'epic-2-retro',
          title: 'Epic 2 Retrospective',
          path: 'retrospectives/epic-2-retro-2025-11-06.md',
        },
      ],
    };
  }

  /**
   * Cache document metadata
   */
  async cacheDocumentMetadata(doc: Document): Promise<void> {
    const metadata: DocumentMetadata = {
      path: doc.path,
      title: doc.title,
      description: doc.description,
      category: doc.category,
      epicId: doc.epicId,
      storyId: doc.storyId,
      wordCount: doc.wordCount,
      lineCount: doc.lineCount,
      lastModified: doc.lastModified,
    };

    // Cache for 1 hour
    await this.cache.put(`doc_meta:${doc.path}`, JSON.stringify(metadata), {
      expirationTtl: 60 * 60,
    });
  }

  /**
   * Get cached document metadata
   */
  async getCachedDocumentMetadata(path: string): Promise<DocumentMetadata | null> {
    const cached = await this.cache.get<DocumentMetadata>(`doc_meta:${path}`, 'json');
    return cached ?? null;
  }

  /**
   * Create loader for environment
   */
  static forEnv(env: LoaderEnv): DocumentLoader {
    return new DocumentLoader(env);
  }
}

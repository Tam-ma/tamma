import { describe, it, expect, beforeEach } from 'vitest';
import { ContextAggregator, createContextAggregator } from '../../aggregator.js';
import type {
  IContextSource,
  ContextSourceType,
  SourceConfig,
  SourceQuery,
  SourceResult,
  ContextChunk,
  ContextRequest,
} from '../../types.js';

/** Simple in-memory source for integration testing */
class InMemorySource implements IContextSource {
  readonly name: ContextSourceType;
  private docs: ContextChunk[];

  constructor(name: ContextSourceType, docs: ContextChunk[]) {
    this.name = name;
    this.docs = docs;
  }

  async initialize(_config: SourceConfig): Promise<void> {}
  async isAvailable(): Promise<boolean> { return true; }
  async retrieve(query: SourceQuery): Promise<SourceResult> {
    // Simple keyword matching
    const words = query.text.toLowerCase().split(/\s+/);
    const matched = this.docs.filter(d =>
      words.some(w => d.content.toLowerCase().includes(w))
    );
    return {
      chunks: matched.slice(0, query.maxChunks),
      latencyMs: 2,
      cacheHit: false,
    };
  }
  async dispose(): Promise<void> {}
}

describe('ContextAggregator Integration', () => {
  let aggregator: ContextAggregator;

  const codeChunks: ContextChunk[] = [
    {
      id: 'auth-1',
      content: 'export async function authenticate(token: string) { return verifyJWT(token); }',
      source: 'vector_db',
      relevance: 0.95,
      metadata: { filePath: 'src/auth.ts', startLine: 1, endLine: 3, language: 'typescript' },
      tokenCount: 30,
    },
    {
      id: 'db-1',
      content: 'export class DatabaseClient { async query(sql: string) { return this.pool.query(sql); } }',
      source: 'vector_db',
      relevance: 0.7,
      metadata: { filePath: 'src/db.ts', startLine: 1, endLine: 5, language: 'typescript' },
      tokenCount: 40,
    },
  ];

  const docChunks: ContextChunk[] = [
    {
      id: 'doc-auth',
      content: '# Authentication\\nThe auth module uses JWT tokens for authentication.',
      source: 'rag',
      relevance: 0.85,
      metadata: { title: 'Auth Documentation' },
      tokenCount: 25,
    },
  ];

  beforeEach(() => {
    aggregator = createContextAggregator({
      config: {
        caching: { enabled: true, ttlSeconds: 300, maxEntries: 100, provider: 'memory' },
      },
    });
    aggregator.registerSource(new InMemorySource('vector_db', codeChunks));
    aggregator.registerSource(new InMemorySource('rag', docChunks));
  });

  it('should retrieve relevant context from multiple sources', async () => {
    const response = await aggregator.getContext({
      query: 'authenticate token',
      taskType: 'analysis',
      maxTokens: 4000,
    });

    expect(response.context.chunks.length).toBeGreaterThan(0);
    expect(response.context.text).toContain('authenticate');
    expect(response.metrics.sourcesSucceeded).toBe(2);
  });

  it('should produce XML format by default', async () => {
    const response = await aggregator.getContext({
      query: 'authentication',
      taskType: 'analysis',
      maxTokens: 4000,
    });

    expect(response.context.format).toBe('xml');
    expect(response.context.text).toContain('<retrieved_context>');
  });

  it('should produce markdown when requested', async () => {
    const response = await aggregator.getContext({
      query: 'authentication',
      taskType: 'analysis',
      maxTokens: 4000,
      options: { format: 'markdown' },
    });

    expect(response.context.format).toBe('markdown');
    expect(response.context.text).toContain('###');
  });

  it('should respect token budget', async () => {
    const response = await aggregator.getContext({
      query: 'auth',
      taskType: 'analysis',
      maxTokens: 100, // very tight budget
    });

    expect(response.metrics.budgetUtilization).toBeLessThanOrEqual(1);
  });

  it('should cache and return same result', async () => {
    const request: ContextRequest = {
      query: 'auth',
      taskType: 'analysis',
      maxTokens: 4000,
    };
    const r1 = await aggregator.getContext(request);
    const r2 = await aggregator.getContext(request);

    expect(r2.context.text).toEqual(r1.context.text);
  });

  it('should perform end-to-end pipeline', async () => {
    const response = await aggregator.getContext({
      query: 'database query',
      taskType: 'implementation',
      maxTokens: 8000,
      hints: {
        language: 'typescript',
        relatedFiles: ['src/db.ts'],
      },
    });

    // Should have a complete response
    expect(response.requestId).toBeDefined();
    expect(response.context).toBeDefined();
    expect(response.sources).toBeDefined();
    expect(response.metrics).toBeDefined();
    expect(response.metrics.totalLatencyMs).toBeGreaterThanOrEqual(0);
    expect(response.context.tokenCount).toBeGreaterThan(0);
  });
});

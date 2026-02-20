/**
 * Knowledge Base Services Tests
 *
 * Unit tests for the knowledge base service layer.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { IndexManagementService } from '../services/knowledge-base/IndexManagementService.js';
import { VectorDBManagementService } from '../services/knowledge-base/VectorDBManagementService.js';
import { RAGManagementService } from '../services/knowledge-base/RAGManagementService.js';
import { MCPManagementService } from '../services/knowledge-base/MCPManagementService.js';
import { ContextTestingService } from '../services/knowledge-base/ContextTestingService.js';
import { AnalyticsService } from '../services/knowledge-base/AnalyticsService.js';

describe('IndexManagementService', () => {
  let service: IndexManagementService;

  beforeEach(() => {
    service = new IndexManagementService();
  });

  it('returns idle status initially', async () => {
    const status = await service.getStatus();
    expect(status.status).toBe('idle');
    expect(status.filesIndexed).toBe(0);
    expect(status.chunksCreated).toBe(0);
  });

  it('triggers indexing and updates status', async () => {
    await service.triggerIndex();
    const status = await service.getStatus();
    expect(status.status).toBe('indexing');
    expect(status.progress).toBeDefined();
    service.dispose();
  });

  it('throws when triggering while already indexing', async () => {
    await service.triggerIndex();
    await expect(service.triggerIndex()).rejects.toThrow('already in progress');
    service.dispose();
  });

  it('cancels indexing', async () => {
    await service.triggerIndex();
    await service.cancelIndex();
    const status = await service.getStatus();
    expect(status.status).toBe('idle');
  });

  it('throws when cancelling without indexing', async () => {
    await expect(service.cancelIndex()).rejects.toThrow('No indexing operation');
  });

  it('returns empty history initially', async () => {
    const history = await service.getHistory();
    expect(history).toEqual([]);
  });

  it('returns default config', async () => {
    const config = await service.getConfig();
    expect(config.includePatterns).toBeDefined();
    expect(config.excludePatterns).toBeDefined();
    expect(config.chunkingConfig.maxTokens).toBe(500);
  });

  it('updates config', async () => {
    const updated = await service.updateConfig({
      includePatterns: ['**/*.py'],
      chunkingConfig: { maxTokens: 1000, overlapTokens: 50, preserveImports: true, groupRelatedCode: true },
    });
    expect(updated.includePatterns).toContain('**/*.py');
    expect(updated.chunkingConfig.maxTokens).toBe(1000);
  });
});

describe('VectorDBManagementService', () => {
  let service: VectorDBManagementService;

  beforeEach(() => {
    service = new VectorDBManagementService();
  });

  it('lists collections with default codebase collection', async () => {
    const collections = await service.listCollections();
    expect(collections.length).toBeGreaterThan(0);
    expect(collections[0]!.name).toBe('codebase');
  });

  it('creates a new collection', async () => {
    await service.createCollection('test', 768);
    const collections = await service.listCollections();
    expect(collections.find((c) => c.name === 'test')).toBeDefined();
  });

  it('throws when creating duplicate collection', async () => {
    await expect(service.createCollection('codebase')).rejects.toThrow('already exists');
  });

  it('deletes a collection', async () => {
    await service.createCollection('to-delete');
    await service.deleteCollection('to-delete');
    const collections = await service.listCollections();
    expect(collections.find((c) => c.name === 'to-delete')).toBeUndefined();
  });

  it('gets collection stats', async () => {
    const stats = await service.getCollectionStats('codebase');
    expect(stats.name).toBe('codebase');
    expect(stats.vectorCount).toBeGreaterThan(0);
    expect(stats.queryMetrics).toBeDefined();
  });

  it('performs similarity search', async () => {
    const results = await service.search({
      collection: 'codebase',
      query: 'authentication',
      topK: 3,
    });
    expect(results.length).toBeLessThanOrEqual(3);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.score).toBeLessThanOrEqual(1);
  });

  it('gets storage usage', async () => {
    const usage = await service.getStorageUsage();
    expect(usage.totalBytes).toBeGreaterThan(0);
    expect(usage.byCollection['codebase']).toBeDefined();
  });
});

describe('RAGManagementService', () => {
  let service: RAGManagementService;

  beforeEach(() => {
    service = new RAGManagementService();
  });

  it('returns default config', async () => {
    const config = await service.getConfig();
    expect(config.sources.vectorDb.enabled).toBe(true);
    expect(config.ranking.fusionMethod).toBe('rrf');
    expect(config.assembly.maxTokens).toBe(4000);
  });

  it('updates config', async () => {
    const updated = await service.updateConfig({
      assembly: { maxTokens: 8000, format: 'markdown', includeScores: false },
    });
    expect(updated.assembly.maxTokens).toBe(8000);
  });

  it('returns metrics', async () => {
    const metrics = await service.getMetrics();
    expect(typeof metrics.totalQueries).toBe('number');
    expect(typeof metrics.avgLatencyMs).toBe('number');
    expect(metrics.sourceBreakdown).toBeDefined();
  });

  it('executes test query', async () => {
    const result = await service.testQuery({ query: 'test query', topK: 5 });
    expect(result.queryId).toBeDefined();
    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.assembledContext).toBeDefined();
    expect(result.tokenCount).toBeGreaterThan(0);
  });
});

describe('MCPManagementService', () => {
  let service: MCPManagementService;

  beforeEach(() => {
    service = new MCPManagementService();
  });

  it('lists servers with seed data', async () => {
    const servers = await service.listServers();
    expect(servers.length).toBe(3);
    expect(servers.map((s) => s.name)).toContain('filesystem');
  });

  it('gets server status', async () => {
    const server = await service.getServerStatus('filesystem');
    expect(server.name).toBe('filesystem');
    expect(server.status).toBe('connected');
  });

  it('throws for unknown server', async () => {
    await expect(service.getServerStatus('nonexistent')).rejects.toThrow('not found');
  });

  it('stops a running server', async () => {
    await service.stopServer('filesystem');
    const server = await service.getServerStatus('filesystem');
    expect(server.status).toBe('disconnected');
  });

  it('throws when stopping already stopped server', async () => {
    await expect(service.stopServer('memory')).rejects.toThrow('already stopped');
  });

  it('starts a stopped server', async () => {
    await service.startServer('memory');
    const server = await service.getServerStatus('memory');
    expect(server.status).toBe('starting');
  });

  it('lists tools for a server', async () => {
    const tools = await service.listTools('filesystem');
    expect(tools.length).toBeGreaterThan(0);
    expect(tools[0]!.serverName).toBe('filesystem');
  });

  it('invokes a tool', async () => {
    const result = await service.invokeTool({
      serverName: 'filesystem',
      toolName: 'read_file',
      arguments: { path: '/test.txt' },
    });
    expect(result.success).toBe(true);
    expect(result.durationMs).toBeDefined();
  });

  it('gets server logs', async () => {
    const logs = await service.getServerLogs('filesystem');
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0]!.level).toBeDefined();
    expect(logs[0]!.message).toBeDefined();
  });
});

describe('ContextTestingService', () => {
  let service: ContextTestingService;

  beforeEach(() => {
    service = new ContextTestingService();
  });

  it('executes context test', async () => {
    const result = await service.testContext({
      query: 'How does auth work?',
      taskType: 'implementation',
      maxTokens: 4000,
      sources: ['vector_db', 'rag'],
    });

    expect(result.requestId).toBeDefined();
    expect(result.context.chunks.length).toBeGreaterThan(0);
    expect(result.context.tokenCount).toBeGreaterThan(0);
    expect(result.sources.length).toBe(2);
    expect(result.metrics.totalLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it('maintains test history', async () => {
    await service.testContext({
      query: 'test 1',
      taskType: 'analysis',
      maxTokens: 2000,
    });
    await service.testContext({
      query: 'test 2',
      taskType: 'review',
      maxTokens: 3000,
    });

    const history = await service.getRecentTests(10);
    expect(history.length).toBe(2);
  });

  it('submits feedback without error', async () => {
    await expect(
      service.submitFeedback({
        requestId: 'test-id',
        feedback: [{ chunkId: 'chunk-1', rating: 'relevant' }],
      })
    ).resolves.not.toThrow();
  });
});

describe('AnalyticsService', () => {
  let service: AnalyticsService;

  beforeEach(() => {
    service = new AnalyticsService();
  });

  it('returns usage analytics', async () => {
    const analytics = await service.getUsageAnalytics({
      start: new Date(Date.now() - 86400000).toISOString(),
      end: new Date().toISOString(),
    });

    expect(analytics.totalQueries).toBeGreaterThan(0);
    expect(analytics.totalTokensRetrieved).toBeGreaterThan(0);
    expect(analytics.sourceBreakdown).toBeDefined();
  });

  it('returns quality analytics', async () => {
    const analytics = await service.getQualityAnalytics({
      start: new Date(Date.now() - 86400000).toISOString(),
      end: new Date().toISOString(),
    });

    expect(typeof analytics.relevanceRate).toBe('number');
    expect(typeof analytics.avgRelevanceScore).toBe('number');
    expect(analytics.topPerformingSources.length).toBeGreaterThan(0);
  });

  it('returns cost analytics', async () => {
    const analytics = await service.getCostAnalytics({
      start: new Date(Date.now() - 86400000).toISOString(),
      end: new Date().toISOString(),
    });

    expect(analytics.totalCostUsd).toBeGreaterThan(0);
    expect(analytics.breakdown.length).toBeGreaterThan(0);
  });
});

/**
 * Knowledge Base API Routes Tests
 *
 * Integration tests for all Knowledge Base management API endpoints.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerKnowledgeBaseRoutes, createKBServices } from '../routes/knowledge-base/index.js';

describe('Knowledge Base API Routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    const services = createKBServices();
    await registerKnowledgeBaseRoutes(app, services);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // === Index Management ===

  describe('Index Management', () => {
    it('GET /api/knowledge-base/index/status returns current status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/knowledge-base/index/status',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toMatch(/idle|indexing|error/);
      expect(typeof body.filesIndexed).toBe('number');
      expect(typeof body.chunksCreated).toBe('number');
    });

    it('POST /api/knowledge-base/index/trigger triggers indexing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/knowledge-base/index/trigger',
        payload: {},
      });

      expect(response.statusCode).toBe(202);
      expect(response.json().message).toBe('Indexing triggered');

      // Status should show indexing
      const statusResponse = await app.inject({
        method: 'GET',
        url: '/api/knowledge-base/index/status',
      });
      expect(statusResponse.json().status).toBe('indexing');
    });

    it('POST /api/knowledge-base/index/trigger returns 409 if already indexing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/knowledge-base/index/trigger',
        payload: {},
      });

      expect(response.statusCode).toBe(409);
    });

    it('DELETE /api/knowledge-base/index/cancel cancels indexing', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/knowledge-base/index/cancel',
      });

      expect(response.statusCode).toBe(200);
    });

    it('GET /api/knowledge-base/index/history returns history', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/knowledge-base/index/history',
      });

      expect(response.statusCode).toBe(200);
      expect(Array.isArray(response.json())).toBe(true);
    });

    it('GET /api/knowledge-base/index/config returns configuration', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/knowledge-base/index/config',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.includePatterns).toBeDefined();
      expect(body.excludePatterns).toBeDefined();
      expect(body.chunkingConfig).toBeDefined();
    });

    it('PUT /api/knowledge-base/index/config updates configuration', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/knowledge-base/index/config',
        payload: {
          includePatterns: ['**/*.ts'],
          chunkingConfig: { maxTokens: 1000 },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.includePatterns).toContain('**/*.ts');
    });
  });

  // === Vector Database ===

  describe('Vector Database', () => {
    it('GET /api/knowledge-base/vector-db/collections lists collections', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/knowledge-base/vector-db/collections',
      });

      expect(response.statusCode).toBe(200);
      const collections = response.json();
      expect(Array.isArray(collections)).toBe(true);
      expect(collections.length).toBeGreaterThan(0);
      expect(collections[0].name).toBe('codebase');
    });

    it('POST /api/knowledge-base/vector-db/collections creates a collection', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/knowledge-base/vector-db/collections',
        payload: { name: 'test-collection', dimensions: 768 },
      });

      expect(response.statusCode).toBe(201);
    });

    it('POST /api/knowledge-base/vector-db/collections returns 409 for duplicates', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/knowledge-base/vector-db/collections',
        payload: { name: 'codebase' },
      });

      expect(response.statusCode).toBe(409);
    });

    it('GET /api/knowledge-base/vector-db/collections/:name/stats returns stats', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/knowledge-base/vector-db/collections/codebase/stats',
      });

      expect(response.statusCode).toBe(200);
      const stats = response.json();
      expect(stats.name).toBe('codebase');
      expect(typeof stats.vectorCount).toBe('number');
      expect(stats.queryMetrics).toBeDefined();
    });

    it('GET /api/knowledge-base/vector-db/collections/:name/stats returns 404 for unknown', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/knowledge-base/vector-db/collections/nonexistent/stats',
      });

      expect(response.statusCode).toBe(404);
    });

    it('POST /api/knowledge-base/vector-db/search returns results', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/knowledge-base/vector-db/search',
        payload: { collection: 'codebase', query: 'authentication', topK: 5 },
      });

      expect(response.statusCode).toBe(200);
      const results = response.json();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
      expect(typeof results[0].score).toBe('number');
      expect(typeof results[0].content).toBe('string');
    });

    it('DELETE /api/knowledge-base/vector-db/collections/:name deletes a collection', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/knowledge-base/vector-db/collections/test-collection',
      });

      expect(response.statusCode).toBe(200);
    });

    it('GET /api/knowledge-base/vector-db/storage returns storage usage', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/knowledge-base/vector-db/storage',
      });

      expect(response.statusCode).toBe(200);
      const usage = response.json();
      expect(typeof usage.totalBytes).toBe('number');
      expect(usage.byCollection).toBeDefined();
    });
  });

  // === RAG Pipeline ===

  describe('RAG Pipeline', () => {
    it('GET /api/knowledge-base/rag/config returns configuration', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/knowledge-base/rag/config',
      });

      expect(response.statusCode).toBe(200);
      const config = response.json();
      expect(config.sources).toBeDefined();
      expect(config.ranking).toBeDefined();
      expect(config.assembly).toBeDefined();
      expect(config.caching).toBeDefined();
    });

    it('PUT /api/knowledge-base/rag/config updates configuration', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/knowledge-base/rag/config',
        payload: { assembly: { maxTokens: 8000 } },
      });

      expect(response.statusCode).toBe(200);
    });

    it('GET /api/knowledge-base/rag/metrics returns metrics', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/knowledge-base/rag/metrics',
      });

      expect(response.statusCode).toBe(200);
      const metrics = response.json();
      expect(typeof metrics.totalQueries).toBe('number');
      expect(typeof metrics.avgLatencyMs).toBe('number');
    });

    it('POST /api/knowledge-base/rag/test executes a test query', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/knowledge-base/rag/test',
        payload: { query: 'How does authentication work?', topK: 5 },
      });

      expect(response.statusCode).toBe(200);
      const result = response.json();
      expect(result.queryId).toBeDefined();
      expect(result.chunks).toBeDefined();
      expect(result.assembledContext).toBeDefined();
      expect(typeof result.tokenCount).toBe('number');
      expect(typeof result.latencyMs).toBe('number');
    });
  });

  // === MCP Servers ===

  describe('MCP Servers', () => {
    it('GET /api/knowledge-base/mcp/servers lists servers', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/knowledge-base/mcp/servers',
      });

      expect(response.statusCode).toBe(200);
      const servers = response.json();
      expect(Array.isArray(servers)).toBe(true);
      expect(servers.length).toBeGreaterThan(0);
    });

    it('GET /api/knowledge-base/mcp/servers/:name returns server status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/knowledge-base/mcp/servers/filesystem',
      });

      expect(response.statusCode).toBe(200);
      const server = response.json();
      expect(server.name).toBe('filesystem');
      expect(server.status).toBeDefined();
    });

    it('GET /api/knowledge-base/mcp/servers/:name returns 404 for unknown', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/knowledge-base/mcp/servers/nonexistent',
      });

      expect(response.statusCode).toBe(404);
    });

    it('POST /api/knowledge-base/mcp/servers/:name/stop stops a server', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/knowledge-base/mcp/servers/filesystem/stop',
      });

      expect(response.statusCode).toBe(200);
    });

    it('POST /api/knowledge-base/mcp/servers/:name/start starts a server', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/knowledge-base/mcp/servers/filesystem/start',
      });

      expect(response.statusCode).toBe(202);
    });

    it('GET /api/knowledge-base/mcp/servers/:name/tools lists tools', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/knowledge-base/mcp/servers/filesystem/tools',
      });

      expect(response.statusCode).toBe(200);
      const tools = response.json();
      expect(Array.isArray(tools)).toBe(true);
    });

    it('GET /api/knowledge-base/mcp/servers/:name/logs returns logs', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/knowledge-base/mcp/servers/filesystem/logs',
      });

      expect(response.statusCode).toBe(200);
      const logs = response.json();
      expect(Array.isArray(logs)).toBe(true);
    });
  });

  // === Context Testing ===

  describe('Context Testing', () => {
    it('POST /api/knowledge-base/context/test executes context test', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/knowledge-base/context/test',
        payload: {
          query: 'How does the authentication flow work?',
          taskType: 'implementation',
          maxTokens: 4000,
          sources: ['vector_db', 'rag'],
        },
      });

      expect(response.statusCode).toBe(200);
      const result = response.json();
      expect(result.requestId).toBeDefined();
      expect(result.context).toBeDefined();
      expect(result.context.chunks.length).toBeGreaterThan(0);
      expect(result.sources).toBeDefined();
      expect(result.metrics).toBeDefined();
      expect(typeof result.metrics.totalLatencyMs).toBe('number');
    });

    it('POST /api/knowledge-base/context/feedback submits feedback', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/knowledge-base/context/feedback',
        payload: {
          requestId: 'test-id',
          feedback: [{ chunkId: 'chunk-1', rating: 'relevant' }],
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('GET /api/knowledge-base/context/history returns test history', async () => {
      // First, create some history by running a test
      await app.inject({
        method: 'POST',
        url: '/api/knowledge-base/context/test',
        payload: {
          query: 'test query',
          taskType: 'analysis',
          maxTokens: 2000,
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/knowledge-base/context/history?limit=5',
      });

      expect(response.statusCode).toBe(200);
      const history = response.json();
      expect(Array.isArray(history)).toBe(true);
      expect(history.length).toBeGreaterThan(0);
    });
  });

  // === Analytics ===

  describe('Analytics', () => {
    it('GET /api/knowledge-base/analytics/usage returns usage analytics', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/knowledge-base/analytics/usage',
      });

      expect(response.statusCode).toBe(200);
      const analytics = response.json();
      expect(analytics.period).toBeDefined();
      expect(typeof analytics.totalQueries).toBe('number');
      expect(typeof analytics.totalTokensRetrieved).toBe('number');
    });

    it('GET /api/knowledge-base/analytics/quality returns quality metrics', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/knowledge-base/analytics/quality',
      });

      expect(response.statusCode).toBe(200);
      const analytics = response.json();
      expect(typeof analytics.relevanceRate).toBe('number');
      expect(typeof analytics.avgRelevanceScore).toBe('number');
    });

    it('GET /api/knowledge-base/analytics/costs returns cost breakdown', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/knowledge-base/analytics/costs',
      });

      expect(response.statusCode).toBe(200);
      const analytics = response.json();
      expect(typeof analytics.totalCostUsd).toBe('number');
      expect(Array.isArray(analytics.breakdown)).toBe(true);
    });
  });
});

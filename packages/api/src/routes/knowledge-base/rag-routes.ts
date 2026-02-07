/**
 * RAG Pipeline Routes
 *
 * API endpoints for RAG pipeline configuration and testing.
 */

import type { FastifyInstance } from 'fastify';
import type { RAGManagementService } from '../../services/knowledge-base/RAGManagementService.js';
import type { RAGConfigInfo, RAGTestRequest } from '@tamma/shared';

export function registerRAGRoutes(
  app: FastifyInstance,
  service: RAGManagementService,
): void {
  // GET /rag/config - Get RAG configuration
  app.get('/rag/config', async (_request, reply) => {
    const config = await service.getConfig();
    return reply.send(config);
  });

  // PUT /rag/config - Update RAG configuration
  app.put('/rag/config', async (request, reply) => {
    const body = request.body as Partial<RAGConfigInfo>;
    const config = await service.updateConfig(body);
    return reply.send(config);
  });

  // GET /rag/metrics - Get RAG metrics
  app.get('/rag/metrics', async (_request, reply) => {
    const metrics = await service.getMetrics();
    return reply.send(metrics);
  });

  // POST /rag/test - Test RAG query
  app.post('/rag/test', async (request, reply) => {
    const body = request.body as RAGTestRequest;
    const result = await service.testQuery(body);
    return reply.send(result);
  });
}

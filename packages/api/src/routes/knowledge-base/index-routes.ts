/**
 * Index Management Routes
 *
 * API endpoints for codebase indexing operations.
 */

import type { FastifyInstance } from 'fastify';
import type { IndexManagementService } from '../../services/knowledge-base/IndexManagementService.js';

export function registerIndexRoutes(
  app: FastifyInstance,
  service: IndexManagementService,
): void {
  // GET /index/status - Get current indexing status
  app.get('/index/status', async (_request, reply) => {
    const status = await service.getStatus();
    return reply.send(status);
  });

  // POST /index/trigger - Trigger manual re-index
  app.post('/index/trigger', async (request, reply) => {
    try {
      const body = request.body as { fullReindex?: boolean } | undefined;
      await service.triggerIndex(body);
      return reply.status(202).send({ message: 'Indexing triggered' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(409).send({ error: message });
    }
  });

  // DELETE /index/cancel - Cancel running index
  app.delete('/index/cancel', async (_request, reply) => {
    try {
      await service.cancelIndex();
      return reply.send({ message: 'Indexing cancelled' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(409).send({ error: message });
    }
  });

  // GET /index/history - Get indexing history
  app.get('/index/history', async (request, reply) => {
    const query = request.query as { limit?: string };
    const limit = query.limit ? parseInt(query.limit, 10) : 20;
    const history = await service.getHistory(limit);
    return reply.send(history);
  });

  // GET /index/config - Get index configuration
  app.get('/index/config', async (_request, reply) => {
    const config = await service.getConfig();
    return reply.send(config);
  });

  // PUT /index/config - Update index configuration
  app.put('/index/config', async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const config = await service.updateConfig(body);
    return reply.send(config);
  });
}

/**
 * Context Testing Routes
 *
 * API endpoints for interactive context retrieval testing.
 */

import type { FastifyInstance } from 'fastify';
import type { ContextTestingService } from '../../services/knowledge-base/ContextTestingService.js';
import type { ContextTestRequest, ContextFeedbackRequest } from '@tamma/shared';

export function registerContextRoutes(
  app: FastifyInstance,
  service: ContextTestingService,
): void {
  // POST /context/test - Test context retrieval
  app.post('/context/test', async (request, reply) => {
    const body = request.body as ContextTestRequest;
    const result = await service.testContext(body);
    return reply.send(result);
  });

  // POST /context/feedback - Submit relevance feedback
  app.post('/context/feedback', async (request, reply) => {
    const body = request.body as ContextFeedbackRequest;
    await service.submitFeedback(body);
    return reply.send({ message: 'Feedback submitted' });
  });

  // GET /context/history - Get test history
  app.get('/context/history', async (request, reply) => {
    const query = request.query as { limit?: string };
    const limit = query.limit ? parseInt(query.limit, 10) : 10;
    const history = await service.getRecentTests(limit);
    return reply.send(history);
  });
}

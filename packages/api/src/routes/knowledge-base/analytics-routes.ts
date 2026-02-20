/**
 * Analytics Routes
 *
 * API endpoints for knowledge base analytics and reporting.
 */

import type { FastifyInstance } from 'fastify';
import type { AnalyticsService } from '../../services/knowledge-base/AnalyticsService.js';

function parsePeriod(query: Record<string, string | undefined>): { start: string; end: string } {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  return {
    start: query['start'] ?? thirtyDaysAgo.toISOString(),
    end: query['end'] ?? now.toISOString(),
  };
}

export function registerAnalyticsRoutes(
  app: FastifyInstance,
  service: AnalyticsService,
): void {
  // GET /analytics/usage - Get usage analytics
  app.get('/analytics/usage', async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const period = parsePeriod(query);
    const analytics = await service.getUsageAnalytics(period);
    return reply.send(analytics);
  });

  // GET /analytics/quality - Get quality metrics
  app.get('/analytics/quality', async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const period = parsePeriod(query);
    const analytics = await service.getQualityAnalytics(period);
    return reply.send(analytics);
  });

  // GET /analytics/costs - Get cost breakdown
  app.get('/analytics/costs', async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const period = parsePeriod(query);
    const analytics = await service.getCostAnalytics(period);
    return reply.send(analytics);
  });
}

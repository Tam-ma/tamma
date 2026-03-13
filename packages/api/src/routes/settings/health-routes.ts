/**
 * Provider health routes.
 */

import type { FastifyInstance } from 'fastify';
import type { HealthService } from '../../services/settings/HealthService.js';

export function registerHealthRoutes(app: FastifyInstance, service: HealthService): void {
  app.get('/health', async (_request, reply) => {
    const status = await service.getStatus();
    return reply.send(status);
  });
}

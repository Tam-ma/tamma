/**
 * Agents configuration routes.
 */

import type { FastifyInstance } from 'fastify';
import type { ConfigService } from '../../services/settings/ConfigService.js';

export function registerAgentsRoutes(app: FastifyInstance, service: ConfigService): void {
  app.get('/agents', async (_request, reply) => {
    const config = await service.getAgentsConfig();
    return reply.send(config);
  });

  app.put('/agents', async (request, reply) => {
    try {
      const body = request.body as import('@tamma/shared').IAgentsConfig;
      const updated = await service.updateAgentsConfig(body);
      return reply.send(updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid configuration';
      return reply.status(400).send({ error: message });
    }
  });
}

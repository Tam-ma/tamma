/**
 * Security configuration routes.
 */

import type { FastifyInstance } from 'fastify';
import type { ConfigService } from '../../services/settings/ConfigService.js';

export function registerSecurityRoutes(app: FastifyInstance, service: ConfigService): void {
  app.get('/security', async (_request, reply) => {
    const config = await service.getSecurityConfig();
    return reply.send(config);
  });

  app.put('/security', async (request, reply) => {
    try {
      const body = request.body as import('@tamma/shared').SecurityConfig;
      const updated = await service.updateSecurityConfig(body);
      return reply.send(updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid configuration';
      return reply.status(400).send({ error: message });
    }
  });
}

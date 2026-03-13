/**
 * Diagnostics routes.
 */

import type { FastifyInstance } from 'fastify';
import type { DiagnosticsService } from '../../services/settings/DiagnosticsService.js';
import type { DiagnosticsEventType } from '@tamma/shared';

const VALID_EVENT_TYPES = new Set<string>([
  'tool:invoke',
  'tool:complete',
  'tool:error',
  'provider:call',
  'provider:complete',
  'provider:error',
]);

export function registerDiagnosticsRoutes(app: FastifyInstance, service: DiagnosticsService): void {
  app.get('/diagnostics', async (request, reply) => {
    const query = request.query as {
      limit?: string;
      type?: string;
      since?: string;
    };

    const options: {
      limit?: number;
      type?: DiagnosticsEventType;
      since?: number;
    } = {};

    if (query.limit) {
      const limit = parseInt(query.limit, 10);
      if (Number.isFinite(limit) && limit > 0) {
        options.limit = Math.min(limit, 200);
      }
    }

    if (query.type) {
      if (!VALID_EVENT_TYPES.has(query.type)) {
        return reply.status(400).send({ error: `Invalid event type: ${query.type}` });
      }
      options.type = query.type as DiagnosticsEventType;
    }

    if (query.since) {
      const since = parseInt(query.since, 10);
      if (Number.isFinite(since)) {
        options.since = since;
      }
    }

    const events = await service.getEvents(options);
    return reply.send(events);
  });
}

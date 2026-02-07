/**
 * @tamma/api
 * Fastify REST API + SSE for the Tamma platform
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { registerKnowledgeBaseRoutes, createKBServices } from './routes/knowledge-base/index.js';
import type { KBServices } from './routes/knowledge-base/index.js';

export { registerKnowledgeBaseRoutes, createKBServices };
export type { KBServices };

/**
 * Create and configure the Fastify API server.
 */
export async function createApp(services?: KBServices) {
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: true });

  // Health check
  app.get('/api/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // Knowledge Base Management routes
  await registerKnowledgeBaseRoutes(app, services);

  return app;
}

/**
 * Start the API server (used when running standalone).
 */
export async function startServer(port = 3001, host = '0.0.0.0') {
  const app = await createApp();
  await app.listen({ port, host });
  return app;
}

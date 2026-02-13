/**
 * @tamma/api
 * Fastify REST API + SSE for the Tamma platform
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { registerKnowledgeBaseRoutes, createKBServices } from './routes/knowledge-base/index.js';
import type { KBServices } from './routes/knowledge-base/index.js';
import { registerEngineRoutes } from './routes/engine/index.js';
import type { EngineRouteOptions } from './routes/engine/index.js';
import { registerAuthPlugin } from './auth/index.js';
import type { AuthConfig } from './auth/index.js';
import { EngineRegistry } from './engine-registry.js';
import type { EngineInfo } from './engine-registry.js';
import { registerWorkflowRoutes } from './routes/workflows/index.js';
import type { WorkflowRouteOptions } from './routes/workflows/index.js';
import { registerDashboardRoutes } from './routes/dashboard/index.js';
import type { DashboardRouteOptions } from './routes/dashboard/index.js';
import { InMemoryWorkflowStore } from './persistence/workflow-store.js';
import type {
  IWorkflowStore,
  WorkflowDefinition,
  WorkflowInstance,
} from './persistence/workflow-store.js';

export {
  registerKnowledgeBaseRoutes,
  createKBServices,
  registerEngineRoutes,
  registerAuthPlugin,
  EngineRegistry,
  registerWorkflowRoutes,
  registerDashboardRoutes,
  InMemoryWorkflowStore,
};

export type {
  KBServices,
  EngineRouteOptions,
  AuthConfig,
  EngineInfo,
  WorkflowRouteOptions,
  DashboardRouteOptions,
  IWorkflowStore,
  WorkflowDefinition,
  WorkflowInstance,
};

/** Options for creating the Fastify app with optional engine support. */
export interface CreateAppOptions {
  /** Knowledge-base services (optional; defaults are created if omitted). */
  kbServices?: KBServices;
  /** Engine to expose via REST/SSE routes (optional). */
  engine?: EngineRouteOptions;
  /** Auth configuration (optional; defaults to dev mode). */
  auth?: AuthConfig;
  /** Workflow store (optional; uses in-memory store if omitted). */
  workflowStore?: IWorkflowStore;
  /** Engine registry for multi-engine support (optional). */
  engineRegistry?: EngineRegistry;
  /** Enable Fastify logger (boolean or pino options object). */
  logger?: boolean | object;
}

/**
 * Create and configure the Fastify API server.
 */
export async function createApp(options?: CreateAppOptions) {
  const app = Fastify({ logger: options?.logger ?? false });

  // Global error handler — return structured errors without leaking stack traces
  app.setErrorHandler((error, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    if (statusCode >= 500) {
      app.log.error(error);
    }
    return reply.status(statusCode).send({
      error: statusCode >= 500 ? 'Internal Server Error' : error.message,
    });
  });

  await app.register(cors, { origin: true });
  await app.register(helmet);

  // Health check
  app.get('/api/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // Auth plugin (if configured)
  if (options?.auth !== undefined) {
    await app.register(registerAuthPlugin, options.auth);
  }

  // Knowledge Base Management routes
  await registerKnowledgeBaseRoutes(app, options?.kbServices);

  // Engine routes (if an engine is provided)
  if (options?.engine !== undefined) {
    await app.register(
      async (instance) => {
        await registerEngineRoutes(instance, options.engine!);
      },
      { prefix: '' },
    );
  }

  // Workflow routes
  if (options?.workflowStore !== undefined) {
    await app.register(
      async (instance) => {
        await registerWorkflowRoutes(instance, { store: options.workflowStore! });
      },
      { prefix: '' },
    );
  }

  // Dashboard routes (requires both engine registry and workflow store)
  if (options?.engineRegistry !== undefined && options?.workflowStore !== undefined) {
    await app.register(
      async (instance) => {
        await registerDashboardRoutes(instance, {
          engineRegistry: options.engineRegistry!,
          workflowStore: options.workflowStore!,
        });
      },
      { prefix: '' },
    );
  }

  return app;
}

/**
 * Start the API server (used when running standalone).
 */
export async function startServer(port = 3001, host = '0.0.0.0', options?: CreateAppOptions) {
  const app = await createApp(options);
  await app.listen({ port, host });
  return app;
}

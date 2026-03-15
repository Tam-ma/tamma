/**
 * SaaS API Routes
 *
 * Registers all SaaS routes under API key auth middleware.
 * Routes:
 * - POST /api/v1/llm/chat
 * - POST /api/v1/workflows/:id/status
 * - POST /api/v1/workflows/:id/result
 * - POST /api/v1/installations/:id/rotate-key
 */

import type { FastifyInstance } from 'fastify';
import type { Octokit } from '@octokit/rest';
import { registerApiKeyAuthPlugin } from '../../auth/api-key-auth.js';
import type { IGitHubInstallationStore } from '../../persistence/installation-store.js';
import type { IWorkflowStore } from '../../persistence/workflow-store.js';
import { registerLlmProxyRoute } from './llm-proxy.js';
import { registerWorkflowStatusRoute } from './workflow-status.js';
import { registerWorkflowResultRoute } from './workflow-result.js';
import { registerKeyRotationRoute } from './key-rotation.js';

export interface SaaSRouteOptions {
  installationStore: IGitHubInstallationStore;
  workflowStore: IWorkflowStore;
  /** Factory that creates an installation-scoped Octokit. */
  createOctokit: (installationId: number) => Promise<Octokit>;
}

/**
 * Register all SaaS API routes on a Fastify instance.
 * All routes are protected by API key auth.
 */
export async function registerSaaSRoutes(
  app: FastifyInstance,
  options: SaaSRouteOptions,
): Promise<void> {
  // Register API key auth plugin - applies to all routes in this scope
  await app.register(registerApiKeyAuthPlugin, {
    installationStore: options.installationStore,
  });

  // Register individual route handlers
  await registerLlmProxyRoute(app);
  await registerWorkflowStatusRoute(app, { workflowStore: options.workflowStore });
  await registerWorkflowResultRoute(app, { workflowStore: options.workflowStore });
  await registerKeyRotationRoute(app, {
    installationStore: options.installationStore,
    createOctokit: options.createOctokit,
  });
}

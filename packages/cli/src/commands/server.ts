/**
 * `tamma server` command
 *
 * Starts a Fastify HTTP server with:
 *  - Engine REST/SSE routes
 *  - Auth plugin
 *  - Workflow sync routes
 *  - Dashboard routes
 *
 * Loads configuration from tamma.config.json + environment variables,
 * creates a TammaEngine, and registers it with the engine registry.
 */

import {
  createApp,
  EngineRegistry,
  InMemoryWorkflowStore,
} from '@tamma/api';
import { TammaEngine } from '@tamma/orchestrator';
import { InMemoryEventStore } from '@tamma/shared';
import { ClaudeAgentProvider } from '@tamma/providers';
import { GitHubPlatform } from '@tamma/platforms';
import { createLogger } from '@tamma/observability';
import { loadConfig, validateConfig } from '../config.js';
import type { CLIOptions } from '../config.js';

export interface ServerOptions extends CLIOptions {
  port?: number;
  host?: string;
}

export async function serverCommand(options: ServerOptions): Promise<void> {
  const config = loadConfig(options);
  const errors = validateConfig(config);

  if (errors.length > 0) {
    console.error('Configuration errors:');
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  const port = options.port ?? 3001;
  const host = options.host ?? '127.0.0.1';

  const logger = createLogger('tamma-server', config.logLevel);

  // Platform + Agent
  const platform = new GitHubPlatform();
  await platform.initialize({ token: config.github.token });

  const agent = new ClaudeAgentProvider();

  // Event store for audit trail
  const eventStore = new InMemoryEventStore();

  // Engine
  const engine = new TammaEngine({
    config,
    platform,
    agent,
    logger,
    eventStore,
  });

  await engine.initialize();

  // Registry
  const engineRegistry = new EngineRegistry();
  engineRegistry.register('default', engine);

  // Workflow store
  const workflowStore = new InMemoryWorkflowStore();

  // Build Fastify app with all plugins via options
  const enableAuth = process.env['TAMMA_ENABLE_AUTH'] === 'true';
  const jwtSecret = process.env['TAMMA_JWT_SECRET'];

  if (enableAuth && !jwtSecret) {
    console.error('Error: TAMMA_JWT_SECRET environment variable is required when TAMMA_ENABLE_AUTH=true.');
    console.error('Generate a secret with: openssl rand -base64 32');
    process.exit(1);
  }

  const app = await createApp({
    engine: { engine },
    auth: {
      jwtSecret: jwtSecret ?? 'unused',
      enableAuth,
    },
    workflowStore,
    engineRegistry,
  });

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    logger.info('Shutting down server...');
    await engineRegistry.disposeAll();
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });

  // Start
  await app.listen({ port, host });
  logger.info(`Tamma server listening on ${host}:${port}`);
}

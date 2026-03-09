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

import * as path from 'node:path';
import {
  createApp,
  EngineRegistry,
  InMemoryWorkflowStore,
} from '@tamma/api';
import { TammaEngine } from '@tamma/orchestrator';
import { InMemoryEventStore, DiagnosticsQueue, ContentSanitizer } from '@tamma/shared';
import {
  RoleBasedAgentResolver,
  AgentProviderFactory,
  ProviderHealthTracker,
  AgentPromptRegistry,
  createDiagnosticsProcessor,
} from '@tamma/providers';
import type { IRoleBasedAgentResolver } from '@tamma/providers';
import { GitHubPlatform } from '@tamma/platforms';
import { createLogger } from '@tamma/observability';
import { createCostTracker, FileStore } from '@tamma/cost-monitor';
import { loadConfig, validateConfig, normalizeAgentsConfig } from '../config.js';
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

  // Platform
  const platform = new GitHubPlatform();
  await platform.initialize({ token: config.github.token });

  // Config-driven agent setup
  const agentsConfig = normalizeAgentsConfig(config);
  const healthTracker = new ProviderHealthTracker();
  const agentFactory = new AgentProviderFactory();
  const promptRegistry = new AgentPromptRegistry({ config: agentsConfig });

  const costStorePath = path.join(config.engine.workingDirectory, '.tamma', 'cost-data.json');
  const costTracker = createCostTracker({ storage: new FileStore(costStorePath) });

  const diagnosticsQueue = new DiagnosticsQueue({ drainIntervalMs: 5000, maxQueueSize: 1000 });
  diagnosticsQueue.setProcessor(createDiagnosticsProcessor(costTracker, logger));

  const sanitizer = config.security?.sanitizeContent !== false ? new ContentSanitizer() : undefined;
  if (sanitizer) {
    logger.info('Content sanitization enabled');
  }

  const resolverOptions: ConstructorParameters<typeof RoleBasedAgentResolver>[0] = {
    config: agentsConfig,
    factory: agentFactory,
    health: healthTracker,
    promptRegistry,
    diagnostics: diagnosticsQueue,
    logger,
  };
  if (costTracker !== undefined) {
    resolverOptions.costTracker = costTracker;
  }
  if (sanitizer !== undefined) {
    resolverOptions.sanitizer = sanitizer;
  }

  const agentResolver: IRoleBasedAgentResolver = new RoleBasedAgentResolver(resolverOptions);

  // Event store for audit trail
  const eventStore = new InMemoryEventStore();

  // Engine
  const engine = new TammaEngine({
    config,
    platform,
    agentResolver,
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
  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) { process.exit(1); return; }
    shuttingDown = true;
    const shutdownTimer = setTimeout(() => { process.exit(1); }, 10_000);
    shutdownTimer.unref();
    logger.info('Shutting down server...');
    try { await engineRegistry.disposeAll(); } catch (err) { logger.error('Engine registry disposal failed', { error: err }); }
    try { await diagnosticsQueue.dispose(); } catch (err) { logger.error('DiagnosticsQueue disposal failed', { error: err }); }
    try { await costTracker.dispose(); } catch (err) { logger.error('CostTracker disposal failed', { error: err }); }
    try { await app.close(); } catch (err) { logger.error('App close failed', { error: err }); }
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

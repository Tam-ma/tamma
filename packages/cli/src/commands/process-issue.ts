/**
 * `tamma process-issue` command.
 *
 * Thin wrapper designed to run inside GitHub Actions (or locally for testing).
 * Parses args, builds config, creates the TammaEngine, calls processOneIssue(),
 * reports the result back to the orchestrator, and exits with the appropriate code.
 *
 * Exit codes:
 *   0  — success
 *   1  — failure
 *   78 — skipped (EX_CONFIG per sysexits.h, used for "nothing to do")
 */

import * as path from 'node:path';
import { TammaEngine } from '@tamma/orchestrator';
import { GitHubPlatform } from '@tamma/platforms';
import { createLogger } from '@tamma/observability';
import { DiagnosticsQueue, ContentSanitizer } from '@tamma/shared';
import type { ILogger } from '@tamma/shared/contracts';
import {
  RoleBasedAgentResolver,
  AgentProviderFactory,
  ProviderHealthTracker,
  AgentPromptRegistry,
  createDiagnosticsProcessor,
} from '@tamma/providers';
import { createCostTracker, FileStore } from '@tamma/cost-monitor';
import { loadConfig, validateConfig, normalizeAgentsConfig } from '../config.js';
import { formatErrorWithSuggestions } from '../error-handler.js';
import { WorkerResultCallback } from '../worker/result-callback.js';

/** Exit codes used by process-issue */
export const EXIT_SUCCESS = 0;
export const EXIT_FAILURE = 1;
export const EXIT_SKIPPED = 78;

/** Options parsed from CLI flags and environment variables. */
export interface ProcessIssueOptions {
  issue: number;
  installationId: string;
  config?: string;
}

/**
 * Detect if running inside GitHub Actions.
 */
function isGitHubActions(): boolean {
  return process.env['GITHUB_ACTIONS'] === 'true';
}

/**
 * Write a GitHub Actions log group annotation.
 */
function actionsGroup(title: string): void {
  if (isGitHubActions()) {
    console.log(`::group::${title}`);
  }
}

/**
 * Close a GitHub Actions log group.
 */
function actionsEndGroup(): void {
  if (isGitHubActions()) {
    console.log('::endgroup::');
  }
}

/**
 * Write a GitHub Actions annotation for errors.
 */
function actionsError(message: string): void {
  if (isGitHubActions()) {
    console.log(`::error::${message}`);
  }
}

/**
 * Create a logger that wraps the standard pino logger with optional
 * GitHub Actions annotations for log section grouping.
 */
function createWorkerLogger(logLevel: string): ILogger {
  const baseLogger = createLogger('tamma-worker', logLevel);

  if (!isGitHubActions()) {
    return baseLogger;
  }

  // In GitHub Actions, wrap to add annotations
  return {
    debug(message: string, context?: Record<string, unknown>) {
      baseLogger.debug(message, context);
    },
    info(message: string, context?: Record<string, unknown>) {
      baseLogger.info(message, context);
    },
    warn(message: string, context?: Record<string, unknown>) {
      baseLogger.warn(message, context);
    },
    error(message: string, context?: Record<string, unknown>) {
      actionsError(message);
      baseLogger.error(message, context);
    },
  };
}

/**
 * Main entry point for the process-issue command.
 * Returns the exit code (does not call process.exit itself to aid testing).
 */
export async function processIssueCommand(options: ProcessIssueOptions): Promise<number> {
  const startTime = Date.now();

  actionsGroup('Configuration');

  // Load config (merges file + env + defaults)
  const config = loadConfig({ config: options.config });
  const errors = validateConfig(config);

  if (errors.length > 0) {
    for (const err of errors) {
      console.error(`Configuration error: ${err}`);
    }
    actionsEndGroup();
    return EXIT_FAILURE;
  }

  // Force auto-approval for worker mode (no human in the loop)
  config.engine.approvalMode = 'auto';

  const logger = createWorkerLogger(config.logLevel);

  logger.info('Process-issue command starting', {
    issueNumber: options.issue,
    installationId: options.installationId,
    isGitHubActions: isGitHubActions(),
  });

  actionsEndGroup();

  // Set up callback reporter if we have API credentials and a workflow ID
  const apiKey = process.env['TAMMA_API_KEY'];
  const apiUrl = process.env['TAMMA_API_URL'] ?? 'https://api.tamma.dev';
  const workflowId = process.env['TAMMA_WORKFLOW_ID'];

  let callback: WorkerResultCallback | undefined;
  if (apiKey && workflowId) {
    callback = new WorkerResultCallback({ apiKey, apiUrl, logger });
    await callback.reportStatus(workflowId, 'running', 'initializing');
  }

  // Set up platform
  actionsGroup('Platform initialization');
  const platform = new GitHubPlatform();
  await platform.initialize({ token: config.github.token });
  actionsEndGroup();

  // Set up agent resolver (same pattern as start command)
  actionsGroup('Agent setup');
  const agentsConfig = normalizeAgentsConfig(config);
  const healthTracker = new ProviderHealthTracker();
  const agentFactory = new AgentProviderFactory();
  const promptRegistry = new AgentPromptRegistry({ config: agentsConfig });

  const costStorePath = path.join(config.engine.workingDirectory, '.tamma', 'cost-data.json');
  const costTracker = createCostTracker({ storage: new FileStore(costStorePath) });

  const diagnosticsQueue = new DiagnosticsQueue({ drainIntervalMs: 5000, maxQueueSize: 1000 });
  diagnosticsQueue.setProcessor(createDiagnosticsProcessor(costTracker, logger));

  const sanitizer = config.security?.sanitizeContent !== false ? new ContentSanitizer() : undefined;

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

  const agentResolver = new RoleBasedAgentResolver(resolverOptions);
  actionsEndGroup();

  // Create engine
  const engine = new TammaEngine({
    config,
    platform,
    agentResolver,
    logger,
  });

  let exitCode = EXIT_SUCCESS;

  try {
    actionsGroup('Engine initialization');
    await engine.initialize();
    actionsEndGroup();

    if (callback && workflowId) {
      await callback.reportStatus(workflowId, 'running', 'processing');
    }

    actionsGroup('Issue processing');
    await engine.processOneIssue();
    actionsEndGroup();

    const durationMs = Date.now() - startTime;
    const stats = engine.getStats();

    logger.info('Issue processed successfully', {
      issueNumber: options.issue,
      durationMs,
      costUsd: stats.totalCostUsd,
    });

    // Report success
    if (callback && workflowId) {
      await callback.reportSuccess(workflowId, {
        issueNumber: options.issue,
        installationId: options.installationId,
        costUsd: stats.totalCostUsd,
        durationMs,
      });
    }

    exitCode = EXIT_SUCCESS;
  } catch (err: unknown) {
    actionsEndGroup();

    const { message, suggestions } = formatErrorWithSuggestions(err);

    logger.error(`Processing failed: ${message}`, { suggestions });
    for (const s of suggestions) {
      logger.error(`  Suggestion: ${s}`);
    }

    // Report failure
    if (callback && workflowId) {
      await callback.reportFailure(workflowId, {
        issueNumber: options.issue,
        installationId: options.installationId,
        error: message,
      });
    }

    // Determine if this is a "skip" scenario
    if (message.includes('No issues found') || message.includes('skipped by user')) {
      exitCode = EXIT_SKIPPED;
    } else {
      exitCode = EXIT_FAILURE;
    }
  } finally {
    // Clean up resources
    actionsGroup('Cleanup');
    try { await engine.dispose(); } catch (err) { logger.error('Engine disposal failed', { error: err }); }
    try { await diagnosticsQueue.dispose(); } catch (err) { logger.error('DiagnosticsQueue disposal failed', { error: err }); }
    try { await costTracker.dispose(); } catch (err) { logger.error('CostTracker disposal failed', { error: err }); }
    actionsEndGroup();
  }

  return exitCode;
}

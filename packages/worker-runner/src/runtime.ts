import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import type { IRepoConfig } from '@tamma/shared';
import {
  loadEnvConfig,
  resolveConfig,
  validateRepoConfig,
  validateConfig,
  normalizeAgentsConfig,
  DiagnosticsQueue,
  ContentSanitizer,
} from '@tamma/shared';
import type { ILogger } from '@tamma/shared/contracts';
import { GitHubPlatform, buildPlatformConfig } from '@tamma/platforms';
import { TammaEngine } from '@tamma/orchestrator';
import {
  RoleBasedAgentResolver,
  AgentProviderFactory,
  ProviderHealthTracker,
  AgentPromptRegistry,
  createDiagnosticsProcessor,
} from '@tamma/providers';
import { FileStore, createCostTracker } from '@tamma/cost-monitor';
import { createLogger } from '@tamma/observability';

export async function createRuntime(dispatched = false, signal?: AbortSignal) {
  const repoFile = '.tamma/config.json';
  const repo: IRepoConfig = existsSync(repoFile) ? JSON.parse(readFileSync(repoFile, 'utf8')) : {};
  validateRepoConfig(repo);
  const { config } = resolveConfig({ providers: {} }, repo, loadEnvConfig());
  const gh = config.github;
  if (gh.authMode === 'saas' || validateConfig(config).length) {
    throw new Error('Incomplete worker repository credentials');
  }
  if (
    dispatched &&
    (gh.authMode !== 'pat' ||
      gh.token !== process.env.GITHUB_TOKEN ||
      process.env.GITHUB_REPOSITORY !== `${gh.owner}/${gh.repo}`)
  ) {
    throw new Error('Invalid dispatch repository credentials');
  }
  config.engine.approvalMode = 'auto';
  const platform = new GitHubPlatform(signal);
  const auth = buildPlatformConfig(gh);
  await platform.initialize({
    ...auth,
    ...(process.env.GITHUB_API_URL ? { baseUrl: process.env.GITHUB_API_URL } : {}),
  });
  const secrets = Object.entries(process.env)
    .filter(([key]) => /token|password|secret|api_key|private_key/i.test(key))
    .map(([, value]) => value);
  secrets.push(auth.type === 'app' ? auth.privateKey : auth.token);
  const logger = workerLogger(createLogger('tamma-worker', config.logLevel), secrets);
  const agents = normalizeAgentsConfig(config);
  const storage = new FileStore(join(config.engine.workingDirectory, '.tamma/cost-data.json'));
  const costTracker = createCostTracker({ storage });
  const diagnostics = new DiagnosticsQueue({ drainIntervalMs: 5000, maxQueueSize: 1000 });
  diagnostics.setProcessor(createDiagnosticsProcessor(costTracker, logger));
  const agentResolver = new RoleBasedAgentResolver({
    config: agents,
    factory: new AgentProviderFactory(),
    health: new ProviderHealthTracker(),
    promptRegistry: new AgentPromptRegistry({ config: agents }),
    diagnostics,
    costTracker,
    logger,
    ...(config.security?.sanitizeContent === false ? {} : { sanitizer: new ContentSanitizer() }),
  });
  const engine = new TammaEngine({
    platform,
    agentResolver,
    logger,
    config,
    ...(signal ? { signal } : {}),
  });
  return {
    engine,
    pollInterval: config.engine.pollIntervalMs,
    async dispose() {
      try {
        await engine.dispose();
      } finally {
        try {
          await diagnostics.dispose();
        } finally {
          await storage.dispose();
        }
      }
    },
  };
}

// Issue text, provider errors and nested SDK context may echo credentials.
export function workerLogger(base: ILogger, values: (string | undefined)[]): ILogger {
  const secrets = values.filter((v): v is string => Boolean(v)).sort((a, b) => b.length - a.length);
  function redact(message: string) {
    for (const secret of secrets) message = message.replaceAll(secret, '[REDACTED]');
    return message;
  }
  function log(level: 'debug' | 'info' | 'warn' | 'error') {
    return (message: string, context?: Record<string, unknown>) => {
      const safe =
        context &&
        JSON.parse(
          JSON.stringify(context, (key, value: unknown) =>
            /authorization|token|password|secret|api.?key|private.?key/i.test(key)
              ? '[REDACTED]'
              : typeof value === 'string'
                ? redact(value)
                : value
          )
        );
      base[level](redact(message), safe);
    };
  }
  return { debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error') };
}

import { readFileSync } from 'node:fs';
import type { TammaConfig, GitHubPATConfig, GitHubAppConfig, GitHubSaaSConfig, AgentConfig, EngineConfig } from '../types/index.js';
import type { SecurityConfig } from '../types/security-config.js';

/**
 * Read a secret from a Docker secret file (via `<ENV_VAR>_FILE`) or fall back
 * to the plain environment variable. This allows containers to consume secrets
 * mounted at `/run/secrets/` without baking values into the environment.
 *
 * Example: if `GITHUB_TOKEN_FILE=/run/secrets/github_token` is set, the
 * contents of that file are returned instead of `process.env.GITHUB_TOKEN`.
 */
export function readSecretOrEnv(envVar: string): string | undefined {
  const filePath = process.env[`${envVar}_FILE`];
  if (filePath) {
    try {
      return readFileSync(filePath, 'utf-8').trim();
    } catch {
      return undefined;
    }
  }
  return process.env[envVar];
}

/**
 * Extract configuration from environment variables.
 * Only returns fields that are actually set.
 */
export function loadEnvConfig(): Partial<TammaConfig> {
  const env = process.env;
  const config: Partial<TammaConfig> = {};

  // GitHub auth mode
  const authMode = env['TAMMA_GITHUB_AUTH_MODE'] ?? 'pat';

  // Common GitHub fields from env
  const githubOwner = env['TAMMA_GITHUB_OWNER'];
  const githubRepo = env['TAMMA_GITHUB_REPO'];
  const botUsername = env['TAMMA_BOT_USERNAME'];
  const issueLabels = env['TAMMA_ISSUE_LABELS'];
  const excludeLabels = env['TAMMA_EXCLUDE_LABELS'];

  if (authMode === 'app') {
    const appId = env['TAMMA_GITHUB_APP_ID'];
    const privateKeyPath = env['TAMMA_GITHUB_PRIVATE_KEY_PATH'];
    const installationId = env['TAMMA_GITHUB_INSTALLATION_ID'];

    const githubOverrides: Partial<GitHubAppConfig> = { authMode: 'app' };
    if (appId !== undefined) githubOverrides.appId = parseInt(appId, 10);
    if (privateKeyPath !== undefined) githubOverrides.privateKeyPath = privateKeyPath;
    if (installationId !== undefined) githubOverrides.installationId = parseInt(installationId, 10);
    if (githubOwner !== undefined) githubOverrides.owner = githubOwner;
    if (githubRepo !== undefined) githubOverrides.repo = githubRepo;
    if (botUsername !== undefined) githubOverrides.botUsername = botUsername;
    if (issueLabels !== undefined) githubOverrides.issueLabels = issueLabels.split(',').map((s) => s.trim());
    if (excludeLabels !== undefined) githubOverrides.excludeLabels = excludeLabels.split(',').map((s) => s.trim());

    if (Object.keys(githubOverrides).length > 1) {
      config.github = githubOverrides as GitHubAppConfig;
    }
  } else if (authMode === 'saas') {
    const appId = env['TAMMA_GITHUB_APP_ID'];
    const privateKeyPath = env['TAMMA_GITHUB_PRIVATE_KEY_PATH'];
    const webhookSecret = env['TAMMA_GITHUB_WEBHOOK_SECRET'];

    const githubOverrides: Partial<GitHubSaaSConfig> = { authMode: 'saas' };
    if (appId !== undefined) githubOverrides.appId = parseInt(appId, 10);
    if (privateKeyPath !== undefined) githubOverrides.privateKeyPath = privateKeyPath;
    if (webhookSecret !== undefined) githubOverrides.webhookSecret = webhookSecret;
    if (botUsername !== undefined) githubOverrides.botUsername = botUsername;
    if (issueLabels !== undefined) githubOverrides.issueLabels = issueLabels.split(',').map((s) => s.trim());
    if (excludeLabels !== undefined) githubOverrides.excludeLabels = excludeLabels.split(',').map((s) => s.trim());
    // SaaS: owner/repo come from installations DB but can be set for testing
    if (githubOwner !== undefined) githubOverrides.owner = githubOwner;
    if (githubRepo !== undefined) githubOverrides.repo = githubRepo;

    config.github = githubOverrides as GitHubSaaSConfig;
  } else {
    // Default: PAT mode
    const githubToken = readSecretOrEnv('GITHUB_TOKEN') ?? readSecretOrEnv('TAMMA_GITHUB_TOKEN');

    const githubOverrides: Partial<GitHubPATConfig> = { authMode: 'pat' };
    if (githubToken !== undefined) githubOverrides.token = githubToken;
    if (githubOwner !== undefined) githubOverrides.owner = githubOwner;
    if (githubRepo !== undefined) githubOverrides.repo = githubRepo;
    if (botUsername !== undefined) githubOverrides.botUsername = botUsername;
    if (issueLabels !== undefined) githubOverrides.issueLabels = issueLabels.split(',').map((s) => s.trim());
    if (excludeLabels !== undefined) githubOverrides.excludeLabels = excludeLabels.split(',').map((s) => s.trim());

    if (Object.keys(githubOverrides).length > 1) {
      config.github = githubOverrides as GitHubPATConfig;
    }
  }

  // Agent config from env
  const model = env['TAMMA_MODEL'];
  const maxBudget = env['TAMMA_MAX_BUDGET_USD'];
  const permissionMode = env['TAMMA_PERMISSION_MODE'];

  const agentOverrides: Partial<AgentConfig> = {};
  if (model !== undefined) agentOverrides.model = model;
  if (maxBudget !== undefined) {
    const parsed = parseFloat(maxBudget);
    if (!Number.isNaN(parsed)) {
      agentOverrides.maxBudgetUsd = parsed;
    }
  }
  if (permissionMode === 'bypassPermissions' || permissionMode === 'default') {
    agentOverrides.permissionMode = permissionMode;
  }

  if (Object.keys(agentOverrides).length > 0) {
    config.agent = agentOverrides as AgentConfig;
  }

  // Engine config from env
  const pollInterval = env['TAMMA_POLL_INTERVAL_MS'];
  const workDir = env['TAMMA_WORKING_DIRECTORY'];
  const approvalMode = env['TAMMA_APPROVAL_MODE'];

  const engineOverrides: Partial<EngineConfig> = {};
  if (pollInterval !== undefined) {
    const parsed = parseInt(pollInterval, 10);
    if (!Number.isNaN(parsed)) {
      engineOverrides.pollIntervalMs = parsed;
    }
  }
  if (workDir !== undefined) engineOverrides.workingDirectory = workDir;
  if (approvalMode === 'cli' || approvalMode === 'auto') {
    engineOverrides.approvalMode = approvalMode;
  }

  if (Object.keys(engineOverrides).length > 0) {
    config.engine = engineOverrides as EngineConfig;
  }

  // Log level
  const logLevel = env['TAMMA_LOG_LEVEL'];
  if (logLevel === 'debug' || logLevel === 'info' || logLevel === 'warn' || logLevel === 'error') {
    config.logLevel = logLevel;
  }

  // Security config from env
  const sanitize = env['TAMMA_SANITIZE_CONTENT'];
  const validateUrls = env['TAMMA_VALIDATE_URLS'];
  const gateActions = env['TAMMA_GATE_ACTIONS'];
  const maxFetchSize = env['TAMMA_MAX_FETCH_SIZE_BYTES'];

  const securityOverrides: Partial<SecurityConfig> = {};
  if (sanitize === 'true' || sanitize === 'false') {
    securityOverrides.sanitizeContent = sanitize === 'true';
  }
  if (validateUrls === 'true' || validateUrls === 'false') {
    securityOverrides.validateUrls = validateUrls === 'true';
  }
  if (gateActions === 'true' || gateActions === 'false') {
    securityOverrides.gateActions = gateActions === 'true';
  }
  if (maxFetchSize !== undefined) {
    const parsed = parseInt(maxFetchSize, 10);
    if (!Number.isNaN(parsed)) {
      securityOverrides.maxFetchSizeBytes = parsed;
    }
  }
  if (Object.keys(securityOverrides).length > 0) {
    config.security = securityOverrides as SecurityConfig;
  }

  // Agent provider from env (maps to legacy agent.provider field)
  const agentProvider = env['TAMMA_AGENT_PROVIDER'];
  if (agentProvider === 'anthropic' || agentProvider === 'openai' || agentProvider === 'local') {
    if (!config.agent) {
      config.agent = {} as AgentConfig;
    }
    (config.agent as Partial<AgentConfig>).provider = agentProvider;
  }

  return config;
}

export function validateConfig(config: TammaConfig): string[] {
  const errors: string[] = [];
  const gh = config.github;

  if (gh.authMode === 'pat') {
    if (!gh.token) {
      errors.push('GitHub token is required (set GITHUB_TOKEN or TAMMA_GITHUB_TOKEN)');
    }
    if (!gh.owner) {
      errors.push('GitHub owner is required (set TAMMA_GITHUB_OWNER or use tamma.config.json)');
    }
    if (!gh.repo) {
      errors.push('GitHub repo is required (set TAMMA_GITHUB_REPO or use tamma.config.json)');
    }
  } else if (gh.authMode === 'app') {
    if (!gh.appId) {
      errors.push('GitHub App ID is required (set TAMMA_GITHUB_APP_ID)');
    }
    if (!gh.privateKeyPath) {
      errors.push('GitHub App private key path is required (set TAMMA_GITHUB_PRIVATE_KEY_PATH)');
    }
    if (!gh.installationId) {
      errors.push('GitHub installation ID is required (set TAMMA_GITHUB_INSTALLATION_ID)');
    }
    if (!gh.owner) {
      errors.push('GitHub owner is required (set TAMMA_GITHUB_OWNER)');
    }
    if (!gh.repo) {
      errors.push('GitHub repo is required (set TAMMA_GITHUB_REPO)');
    }
  } else if (gh.authMode === 'saas') {
    if (!gh.appId) {
      errors.push('GitHub App ID is required (set TAMMA_GITHUB_APP_ID)');
    }
    if (!gh.privateKeyPath) {
      errors.push('GitHub App private key path is required (set TAMMA_GITHUB_PRIVATE_KEY_PATH)');
    }
    if (!gh.webhookSecret) {
      errors.push('GitHub webhook secret is required (set TAMMA_GITHUB_WEBHOOK_SECRET)');
    }
  }

  return errors;
}

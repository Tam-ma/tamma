import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TammaConfig, GitHubConfig, AgentConfig, EngineConfig } from '@tamma/shared';

/** Options from CLI flags that override config file and env vars. */
export interface CLIOptions {
  config?: string | undefined;
  dryRun?: boolean | undefined;
  approval?: 'cli' | 'auto' | undefined;
  once?: boolean | undefined;
  verbose?: boolean | undefined;
}

const DEFAULT_CONFIG: TammaConfig = {
  mode: 'standalone',
  logLevel: 'info',
  github: {
    token: '',
    owner: '',
    repo: '',
    issueLabels: ['tamma'],
    excludeLabels: ['wontfix'],
    botUsername: 'tamma-bot',
  },
  agent: {
    model: 'claude-sonnet-4-5',
    maxBudgetUsd: 1.0,
    allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
    permissionMode: 'default',
  },
  engine: {
    pollIntervalMs: 300_000,
    workingDirectory: process.cwd(),
    maxRetries: 3,
    approvalMode: 'cli',
    ciPollIntervalMs: 30_000,
    ciMonitorTimeoutMs: 3_600_000,
  },
};

/**
 * Load configuration from a JSON file if it exists.
 * Returns undefined if the file does not exist.
 */
function loadConfigFile(configPath: string): Partial<TammaConfig> | undefined {
  const resolved = path.resolve(configPath);
  if (!fs.existsSync(resolved)) {
    return undefined;
  }
  const raw = fs.readFileSync(resolved, 'utf-8');
  return JSON.parse(raw) as Partial<TammaConfig>;
}

/**
 * Extract configuration from environment variables.
 * Only returns fields that are actually set.
 */
function loadEnvConfig(): Partial<TammaConfig> {
  const env = process.env;
  const config: Partial<TammaConfig> = {};

  // GitHub config from env
  const githubToken = env['GITHUB_TOKEN'] ?? env['TAMMA_GITHUB_TOKEN'];
  const githubOwner = env['TAMMA_GITHUB_OWNER'];
  const githubRepo = env['TAMMA_GITHUB_REPO'];
  const botUsername = env['TAMMA_BOT_USERNAME'];
  const issueLabels = env['TAMMA_ISSUE_LABELS'];
  const excludeLabels = env['TAMMA_EXCLUDE_LABELS'];

  const githubOverrides: Partial<GitHubConfig> = {};
  if (githubToken !== undefined) githubOverrides.token = githubToken;
  if (githubOwner !== undefined) githubOverrides.owner = githubOwner;
  if (githubRepo !== undefined) githubOverrides.repo = githubRepo;
  if (botUsername !== undefined) githubOverrides.botUsername = botUsername;
  if (issueLabels !== undefined) githubOverrides.issueLabels = issueLabels.split(',').map((s) => s.trim());
  if (excludeLabels !== undefined) githubOverrides.excludeLabels = excludeLabels.split(',').map((s) => s.trim());

  if (Object.keys(githubOverrides).length > 0) {
    config.github = githubOverrides as GitHubConfig;
  }

  // Agent config from env
  const model = env['TAMMA_MODEL'];
  const maxBudget = env['TAMMA_MAX_BUDGET_USD'];
  const permissionMode = env['TAMMA_PERMISSION_MODE'];

  const agentOverrides: Partial<AgentConfig> = {};
  if (model !== undefined) agentOverrides.model = model;
  if (maxBudget !== undefined) agentOverrides.maxBudgetUsd = parseFloat(maxBudget);
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
  if (pollInterval !== undefined) engineOverrides.pollIntervalMs = parseInt(pollInterval, 10);
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

  return config;
}

/**
 * Merge configs with priority: env vars > CLI options > config file > defaults.
 */
export function loadConfig(cliOptions: CLIOptions): TammaConfig {
  const configPath = cliOptions.config ?? './tamma.config.json';
  const fileConfig = loadConfigFile(configPath);
  const envConfig = loadEnvConfig();

  // Start with defaults
  let config = structuredClone(DEFAULT_CONFIG);

  // Layer 1: config file
  if (fileConfig !== undefined) {
    config = mergeConfig(config, fileConfig);
  }

  // Layer 2: env vars
  config = mergeConfig(config, envConfig);

  // Layer 3: CLI options
  if (cliOptions.approval !== undefined) {
    config.engine.approvalMode = cliOptions.approval;
  }
  if (cliOptions.verbose === true) {
    config.logLevel = 'debug';
  }

  return config;
}

function mergeConfig(base: TammaConfig, override: Partial<TammaConfig>): TammaConfig {
  return {
    mode: override.mode ?? base.mode,
    logLevel: override.logLevel ?? base.logLevel,
    github: { ...base.github, ...override.github },
    agent: { ...base.agent, ...override.agent },
    engine: { ...base.engine, ...override.engine },
  };
}

/**
 * Validate that required fields are present in the config.
 * Returns an array of validation error messages (empty if valid).
 */
export function validateConfig(config: TammaConfig): string[] {
  const errors: string[] = [];

  if (!config.github.token) {
    errors.push('GitHub token is required (set GITHUB_TOKEN or TAMMA_GITHUB_TOKEN)');
  }
  if (!config.github.owner) {
    errors.push('GitHub owner is required (set TAMMA_GITHUB_OWNER or use tamma.config.json)');
  }
  if (!config.github.repo) {
    errors.push('GitHub repo is required (set TAMMA_GITHUB_REPO or use tamma.config.json)');
  }

  return errors;
}

/**
 * Generate a tamma.config.json content from answers.
 */
export function generateConfigFile(answers: {
  token: string;
  owner: string;
  repo: string;
  labels: string;
  approvalMode: string;
}): string {
  const config: Partial<TammaConfig> = {
    mode: 'standalone',
    logLevel: 'info',
    github: {
      token: answers.token,
      owner: answers.owner,
      repo: answers.repo,
      issueLabels: answers.labels.split(',').map((s) => s.trim()),
      excludeLabels: ['wontfix'],
      botUsername: 'tamma-bot',
    },
    agent: {
      model: 'claude-sonnet-4-5',
      maxBudgetUsd: 1.0,
      allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
      permissionMode: 'default',
    },
    engine: {
      pollIntervalMs: 300_000,
      workingDirectory: '.',
      maxRetries: 3,
      approvalMode: answers.approvalMode === 'auto' ? 'auto' : 'cli',
      ciPollIntervalMs: 30_000,
      ciMonitorTimeoutMs: 3_600_000,
    },
  };

  return JSON.stringify(config, null, 2);
}

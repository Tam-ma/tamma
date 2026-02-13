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
  interactive?: boolean | undefined;
  debug?: boolean | undefined;
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
  try {
    return JSON.parse(raw) as Partial<TammaConfig>;
  } catch {
    throw new Error(`Failed to parse config file at ${resolved}. Ensure it contains valid JSON.`);
  }
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
 * Token is NOT stored in the config file — it belongs in .env.
 */
export function generateConfigFile(answers: {
  owner: string;
  repo: string;
  labels: string;
  approvalMode: string;
  model?: string;
  maxBudgetUsd?: number;
  workingDirectory?: string;
}): string {
  const config: Partial<TammaConfig> = {
    mode: 'standalone',
    logLevel: 'info',
    github: {
      token: '',
      owner: answers.owner,
      repo: answers.repo,
      issueLabels: answers.labels.split(',').map((s) => s.trim()),
      excludeLabels: ['wontfix'],
      botUsername: 'tamma-bot',
    },
    agent: {
      model: answers.model ?? 'claude-sonnet-4-5',
      maxBudgetUsd: answers.maxBudgetUsd ?? 1.0,
      allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
      permissionMode: 'default',
    },
    engine: {
      pollIntervalMs: 300_000,
      workingDirectory: answers.workingDirectory ?? '.',
      approvalMode: answers.approvalMode === 'auto' ? 'auto' : 'cli',
      ciPollIntervalMs: 30_000,
      ciMonitorTimeoutMs: 3_600_000,
    },
  };

  return JSON.stringify(config, null, 2);
}

/**
 * Generate a .env file with credentials.
 * Empty values are written as commented placeholders.
 */
export function generateEnvFile(credentials: {
  token: string;
  anthropicKey: string;
}): string {
  const lines: string[] = ['# Tamma credentials — DO NOT COMMIT'];

  if (credentials.token) {
    lines.push(`GITHUB_TOKEN=${credentials.token}`);
  } else {
    lines.push('# GITHUB_TOKEN=ghp_your_token_here');
  }

  if (credentials.anthropicKey) {
    lines.push(`ANTHROPIC_API_KEY=${credentials.anthropicKey}`);
  } else {
    lines.push('# ANTHROPIC_API_KEY=sk-ant-your_key_here');
  }

  lines.push(''); // trailing newline
  return lines.join('\n');
}

/**
 * Merge credentials into an existing .env file.
 * Only updates keys the user actually provided (non-empty).
 * Existing content is preserved for keys not being updated.
 */
export function mergeIntoEnvFile(existingContent: string, credentials: {
  token: string;
  anthropicKey: string;
}): string {
  let content = existingContent;

  if (credentials.token) {
    if (/^#?\s*GITHUB_TOKEN=/m.test(content)) {
      content = content.replace(/^#?\s*GITHUB_TOKEN=.*/m, `GITHUB_TOKEN=${credentials.token}`);
    } else {
      content = content.trimEnd() + `\nGITHUB_TOKEN=${credentials.token}\n`;
    }
  }

  if (credentials.anthropicKey) {
    if (/^#?\s*ANTHROPIC_API_KEY=/m.test(content)) {
      content = content.replace(/^#?\s*ANTHROPIC_API_KEY=.*/m, `ANTHROPIC_API_KEY=${credentials.anthropicKey}`);
    } else {
      content = content.trimEnd() + `\nANTHROPIC_API_KEY=${credentials.anthropicKey}\n`;
    }
  }

  return content;
}

/**
 * Generate a .env.example template with all TAMMA_ environment variables.
 */
export function generateEnvExample(): string {
  return `# Tamma Environment Variables
# Copy this file to .env and fill in the values.

# GitHub — required
GITHUB_TOKEN=
TAMMA_GITHUB_OWNER=
TAMMA_GITHUB_REPO=

# GitHub — optional
TAMMA_BOT_USERNAME=tamma-bot
TAMMA_ISSUE_LABELS=tamma
TAMMA_EXCLUDE_LABELS=wontfix

# Agent
TAMMA_MODEL=claude-sonnet-4-5
TAMMA_MAX_BUDGET_USD=1.00
TAMMA_PERMISSION_MODE=default

# Engine
TAMMA_POLL_INTERVAL_MS=300000
TAMMA_WORKING_DIRECTORY=.
TAMMA_APPROVAL_MODE=cli

# Logging
TAMMA_LOG_LEVEL=info

# Claude CLI agent — required
ANTHROPIC_API_KEY=
`;
}

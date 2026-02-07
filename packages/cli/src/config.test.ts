import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import { loadConfig, validateConfig, generateConfigFile } from './config.js';
import type { CLIOptions } from './config.js';

vi.mock('node:fs');

describe('loadConfig', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    // Clear all TAMMA_ env vars
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('TAMMA_')) {
        delete process.env[key];
      }
    }
    delete process.env['GITHUB_TOKEN'];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return defaults when no config file or env vars', () => {
    const config = loadConfig({});
    expect(config.mode).toBe('standalone');
    expect(config.logLevel).toBe('info');
    expect(config.github.issueLabels).toEqual(['tamma']);
    expect(config.engine.approvalMode).toBe('cli');
    expect(config.engine.pollIntervalMs).toBe(300_000);
  });

  it('should load config from file', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      github: {
        token: 'file-token',
        owner: 'file-owner',
        repo: 'file-repo',
      },
    }));

    const config = loadConfig({});
    expect(config.github.token).toBe('file-token');
    expect(config.github.owner).toBe('file-owner');
    expect(config.github.repo).toBe('file-repo');
  });

  it('should override file config with env vars', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      github: {
        token: 'file-token',
        owner: 'file-owner',
        repo: 'file-repo',
      },
    }));

    process.env['GITHUB_TOKEN'] = 'env-token';
    process.env['TAMMA_GITHUB_OWNER'] = 'env-owner';

    const config = loadConfig({});
    expect(config.github.token).toBe('env-token');
    expect(config.github.owner).toBe('env-owner');
    expect(config.github.repo).toBe('file-repo'); // not overridden
  });

  it('should apply CLI options over everything', () => {
    process.env['TAMMA_APPROVAL_MODE'] = 'auto';

    const options: CLIOptions = {
      approval: 'cli',
      verbose: true,
    };

    const config = loadConfig(options);
    expect(config.engine.approvalMode).toBe('cli');
    expect(config.logLevel).toBe('debug');
  });

  it('should use custom config path', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      github: { token: 'custom-token', owner: 'x', repo: 'y' },
    }));

    const config = loadConfig({ config: '/custom/path.json' });
    expect(config.github.token).toBe('custom-token');
  });

  it('should parse comma-separated issue labels from env', () => {
    process.env['TAMMA_ISSUE_LABELS'] = 'bug, feature, tamma';
    const config = loadConfig({});
    expect(config.github.issueLabels).toEqual(['bug', 'feature', 'tamma']);
  });

  it('should parse TAMMA_GITHUB_TOKEN env var', () => {
    process.env['TAMMA_GITHUB_TOKEN'] = 'tamma-specific-token';
    const config = loadConfig({});
    expect(config.github.token).toBe('tamma-specific-token');
  });

  it('should prefer GITHUB_TOKEN over TAMMA_GITHUB_TOKEN', () => {
    process.env['GITHUB_TOKEN'] = 'generic-token';
    process.env['TAMMA_GITHUB_TOKEN'] = 'specific-token';
    const config = loadConfig({});
    expect(config.github.token).toBe('generic-token');
  });

  it('should parse TAMMA_LOG_LEVEL', () => {
    process.env['TAMMA_LOG_LEVEL'] = 'debug';
    const config = loadConfig({});
    expect(config.logLevel).toBe('debug');
  });

  it('should ignore invalid TAMMA_LOG_LEVEL', () => {
    process.env['TAMMA_LOG_LEVEL'] = 'verbose';
    const config = loadConfig({});
    expect(config.logLevel).toBe('info'); // default
  });

  it('should parse TAMMA_MAX_BUDGET_USD', () => {
    process.env['TAMMA_MAX_BUDGET_USD'] = '5.50';
    const config = loadConfig({});
    expect(config.agent.maxBudgetUsd).toBeCloseTo(5.50);
  });
});

describe('validateConfig', () => {
  it('should return errors for missing required fields', () => {
    const config = loadConfig({});
    const errors = validateConfig(config);
    expect(errors).toContain('GitHub token is required (set GITHUB_TOKEN or TAMMA_GITHUB_TOKEN)');
    expect(errors).toContain('GitHub owner is required (set TAMMA_GITHUB_OWNER or use tamma.config.json)');
    expect(errors).toContain('GitHub repo is required (set TAMMA_GITHUB_REPO or use tamma.config.json)');
  });

  it('should return no errors for valid config', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      github: {
        token: 'token',
        owner: 'owner',
        repo: 'repo',
      },
    }));

    const config = loadConfig({});
    const errors = validateConfig(config);
    expect(errors).toHaveLength(0);
  });
});

describe('generateConfigFile', () => {
  it('should generate valid JSON config', () => {
    const content = generateConfigFile({
      token: 'my-token',
      owner: 'my-org',
      repo: 'my-repo',
      labels: 'tamma, custom',
      approvalMode: 'auto',
    });

    const parsed = JSON.parse(content);
    expect(parsed.github.token).toBe('my-token');
    expect(parsed.github.owner).toBe('my-org');
    expect(parsed.github.repo).toBe('my-repo');
    expect(parsed.github.issueLabels).toEqual(['tamma', 'custom']);
    expect(parsed.engine.approvalMode).toBe('auto');
  });

  it('should default to cli approval mode for unknown values', () => {
    const content = generateConfigFile({
      token: 't',
      owner: 'o',
      repo: 'r',
      labels: 'tamma',
      approvalMode: 'unknown',
    });

    const parsed = JSON.parse(content);
    expect(parsed.engine.approvalMode).toBe('cli');
  });
});

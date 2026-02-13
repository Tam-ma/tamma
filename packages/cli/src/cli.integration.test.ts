import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const hasIntegration = process.env['INTEGRATION_TEST_CLI'] === 'true';

const CLI_PATH = path.resolve(__dirname, 'index.tsx');

function runCli(args: string, options?: { cwd?: string; env?: Record<string, string> }): string {
  try {
    return execSync(`npx tsx ${CLI_PATH} ${args}`, {
      encoding: 'utf-8',
      timeout: 30_000,
      cwd: options?.cwd,
      env: { ...process.env, ...options?.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err: any) {
    // Return combined stdout + stderr for assertion
    return (err.stdout ?? '') + (err.stderr ?? '');
  }
}

describe.skipIf(!hasIntegration)('CLI Integration', () => {
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir !== undefined) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it('should show help information', () => {
    const output = runCli('--help');
    expect(output).toContain('tamma');
    expect(output).toContain('start');
    expect(output).toContain('init');
    expect(output).toContain('status');
  });

  it('should show version', () => {
    const output = runCli('--version');
    expect(output).toContain('0.1.0');
  });

  it('should show status when no engine running', () => {
    const output = runCli('status');
    expect(output).toContain('NOT RUNNING');
  });

  it('should reject start without config', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tamma-cli-test-'));
    // Create a git repo in temp dir so preflight doesn't fail on that
    execSync('git init', { cwd: tempDir, stdio: 'pipe' });

    const output = runCli('start', {
      cwd: tempDir,
      env: {
        // Clear tokens so config validation fails
        GITHUB_TOKEN: '',
        TAMMA_GITHUB_TOKEN: '',
      },
    });
    expect(output).toContain('Configuration errors');
  });

  it('should show start command help with all options', () => {
    const output = runCli('start --help');
    expect(output).toContain('--config');
    expect(output).toContain('--dry-run');
    expect(output).toContain('--once');
    expect(output).toContain('--verbose');
    expect(output).toContain('--interactive');
    expect(output).toContain('--debug');
  });
});

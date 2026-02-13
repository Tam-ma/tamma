import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as child_process from 'node:child_process';
import {
  checkNodeVersion,
  checkGitInstalled,
  checkIsGitRepo,
  checkAnthropicApiKey,
  checkGhCli,
  checkClaudeCli,
  detectGitRemote,
  runPreflight,
} from './preflight.js';

vi.mock('node:child_process');

describe('checkNodeVersion', () => {
  it('should pass when Node.js >= 22', () => {
    const result = checkNodeVersion();
    // Current Node version should be >= 22 in this project
    const major = parseInt(process.version.slice(1).split('.')[0]!, 10);
    expect(result.passed).toBe(major >= 22);
    expect(result.required).toBe(true);
  });
});

describe('checkGitInstalled', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('should pass when git is installed', () => {
    vi.mocked(child_process.execSync).mockReturnValue('git version 2.43.0');
    const result = checkGitInstalled();
    expect(result.passed).toBe(true);
    expect(result.message).toContain('git version');
  });

  it('should fail when git is not installed', () => {
    vi.mocked(child_process.execSync).mockImplementation(() => { throw new Error('not found'); });
    const result = checkGitInstalled();
    expect(result.passed).toBe(false);
    expect(result.required).toBe(true);
  });
});

describe('checkIsGitRepo', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('should pass inside a git repo', () => {
    vi.mocked(child_process.execSync).mockReturnValue('true');
    const result = checkIsGitRepo();
    expect(result.passed).toBe(true);
  });

  it('should fail outside a git repo', () => {
    vi.mocked(child_process.execSync).mockImplementation(() => { throw new Error('not a repo'); });
    const result = checkIsGitRepo();
    expect(result.passed).toBe(false);
  });
});

describe('checkAnthropicApiKey', () => {
  const originalKey = process.env['ANTHROPIC_API_KEY'];

  afterEach(() => {
    if (originalKey !== undefined) {
      process.env['ANTHROPIC_API_KEY'] = originalKey;
    } else {
      delete process.env['ANTHROPIC_API_KEY'];
    }
  });

  it('should pass when ANTHROPIC_API_KEY is set', () => {
    process.env['ANTHROPIC_API_KEY'] = 'test-key';
    const result = checkAnthropicApiKey();
    expect(result.passed).toBe(true);
    expect(result.required).toBe(false);
  });

  it('should fail when ANTHROPIC_API_KEY is not set', () => {
    delete process.env['ANTHROPIC_API_KEY'];
    const result = checkAnthropicApiKey();
    expect(result.passed).toBe(false);
  });
});

describe('checkGhCli', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('should pass when gh is installed', () => {
    vi.mocked(child_process.execSync).mockReturnValue('gh version 2.40.0\n...');
    const result = checkGhCli();
    expect(result.passed).toBe(true);
    expect(result.required).toBe(false);
  });

  it('should fail (optional) when gh is not installed', () => {
    vi.mocked(child_process.execSync).mockImplementation(() => { throw new Error('not found'); });
    const result = checkGhCli();
    expect(result.passed).toBe(false);
    expect(result.required).toBe(false);
  });
});

describe('checkClaudeCli', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('should pass when claude is installed', () => {
    vi.mocked(child_process.execSync).mockReturnValue('1.0.0');
    const result = checkClaudeCli();
    expect(result.passed).toBe(true);
    expect(result.required).toBe(true);
  });

  it('should fail when claude is not installed', () => {
    vi.mocked(child_process.execSync).mockImplementation(() => { throw new Error('not found'); });
    const result = checkClaudeCli();
    expect(result.passed).toBe(false);
  });
});

describe('detectGitRemote', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('should parse HTTPS remote', () => {
    vi.mocked(child_process.execSync).mockReturnValue('https://github.com/my-org/my-repo.git\n');
    const result = detectGitRemote();
    expect(result).toEqual({ owner: 'my-org', repo: 'my-repo' });
  });

  it('should parse SSH remote', () => {
    vi.mocked(child_process.execSync).mockReturnValue('git@github.com:my-org/my-repo.git\n');
    const result = detectGitRemote();
    expect(result).toEqual({ owner: 'my-org', repo: 'my-repo' });
  });

  it('should handle HTTPS without .git suffix', () => {
    vi.mocked(child_process.execSync).mockReturnValue('https://github.com/owner/repo\n');
    const result = detectGitRemote();
    expect(result).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('should handle SSH without .git suffix', () => {
    vi.mocked(child_process.execSync).mockReturnValue('git@github.com:owner/repo\n');
    const result = detectGitRemote();
    expect(result).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('should return null when no remote', () => {
    vi.mocked(child_process.execSync).mockImplementation(() => { throw new Error('no remote'); });
    const result = detectGitRemote();
    expect(result).toBeNull();
  });

  it('should return null for unparseable URL', () => {
    vi.mocked(child_process.execSync).mockReturnValue('some-weird-url\n');
    const result = detectGitRemote();
    expect(result).toBeNull();
  });
});

describe('runPreflight', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('should aggregate all checks', () => {
    // Mock execSync to succeed for all commands
    vi.mocked(child_process.execSync).mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('git --version')) return 'git version 2.43.0';
      if (typeof cmd === 'string' && cmd.includes('git rev-parse')) return 'true';
      if (typeof cmd === 'string' && cmd.includes('claude --version')) return '1.0.0';
      if (typeof cmd === 'string' && cmd.includes('gh --version')) return 'gh version 2.40.0';
      if (typeof cmd === 'string' && cmd.includes('git remote')) return 'https://github.com/test-owner/test-repo.git';
      return '';
    });

    const results = runPreflight();
    expect(results.checks.length).toBeGreaterThanOrEqual(5);
    expect(results.detectedOwner).toBe('test-owner');
    expect(results.detectedRepo).toBe('test-repo');
  });

  it('should report allRequiredPassed=false when required check fails', () => {
    vi.mocked(child_process.execSync).mockImplementation(() => { throw new Error('fail'); });

    const results = runPreflight();
    // Git installed and claude CLI are required, so at least one will fail
    expect(results.allRequiredPassed).toBe(false);
  });
});

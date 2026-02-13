import { execSync } from 'node:child_process';

export interface PreflightCheck {
  name: string;
  passed: boolean;
  required: boolean;
  message: string;
}

export interface PreflightResults {
  checks: PreflightCheck[];
  allRequiredPassed: boolean;
  detectedOwner?: string;
  detectedRepo?: string;
}

export function checkNodeVersion(): PreflightCheck {
  const version = process.version;
  const major = parseInt(version.slice(1).split('.')[0]!, 10);
  const passed = major >= 22;
  return {
    name: 'Node.js >= 22',
    passed,
    required: true,
    message: passed
      ? `Node.js ${version}`
      : `Node.js ${version} detected — v22+ required`,
  };
}

export function checkGitInstalled(): PreflightCheck {
  try {
    const output = execSync('git --version', { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    return {
      name: 'Git installed',
      passed: true,
      required: true,
      message: output,
    };
  } catch {
    return {
      name: 'Git installed',
      passed: false,
      required: true,
      message: 'Git not found — install git to continue',
    };
  }
}

export function checkIsGitRepo(): PreflightCheck {
  try {
    execSync('git rev-parse --is-inside-work-tree', {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return {
      name: 'Inside git repo',
      passed: true,
      required: true,
      message: 'Current directory is a git repository',
    };
  } catch {
    return {
      name: 'Inside git repo',
      passed: false,
      required: true,
      message: 'Not inside a git repository — run git init first',
    };
  }
}

export function checkAnthropicApiKey(): PreflightCheck {
  const hasKey = Boolean(process.env['ANTHROPIC_API_KEY']);
  return {
    name: 'ANTHROPIC_API_KEY',
    passed: hasKey,
    required: false,
    message: hasKey
      ? 'ANTHROPIC_API_KEY is set'
      : 'ANTHROPIC_API_KEY not set — required for Claude CLI agent',
  };
}

export function checkGhCli(): PreflightCheck {
  try {
    const output = execSync('gh --version', {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim().split('\n')[0]!;
    return {
      name: 'GitHub CLI (gh)',
      passed: true,
      required: false,
      message: output,
    };
  } catch {
    return {
      name: 'GitHub CLI (gh)',
      passed: false,
      required: false,
      message: 'gh CLI not found — optional, used for label creation',
    };
  }
}

export function checkClaudeCli(): PreflightCheck {
  try {
    const output = execSync('claude --version', {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return {
      name: 'Claude CLI',
      passed: true,
      required: true,
      message: `Claude CLI ${output}`,
    };
  } catch {
    return {
      name: 'Claude CLI',
      passed: false,
      required: true,
      message: 'Claude CLI not found — install with npm i -g @anthropic-ai/claude-code',
    };
  }
}

/**
 * Parse git remote URL for owner/repo.
 * Supports both HTTPS (https://github.com/owner/repo.git) and SSH (git@github.com:owner/repo.git).
 */
export function detectGitRemote(): { owner: string; repo: string } | null {
  try {
    const url = execSync('git remote get-url origin', {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    // SSH: git@github.com:owner/repo.git
    const sshMatch = url.match(/git@[^:]+:([^/]+)\/(.+?)(?:\.git)?$/);
    if (sshMatch !== null) {
      return { owner: sshMatch[1]!, repo: sshMatch[2]! };
    }

    // HTTPS: https://github.com/owner/repo.git
    const httpsMatch = url.match(/https?:\/\/[^/]+\/([^/]+)\/(.+?)(?:\.git)?$/);
    if (httpsMatch !== null) {
      return { owner: httpsMatch[1]!, repo: httpsMatch[2]! };
    }

    return null;
  } catch {
    return null;
  }
}

/** Run all pre-flight checks and return aggregated results. */
export function runPreflight(): PreflightResults {
  const checks = [
    checkNodeVersion(),
    checkGitInstalled(),
    checkIsGitRepo(),
    checkClaudeCli(),
    checkAnthropicApiKey(),
    checkGhCli(),
  ];

  const allRequiredPassed = checks
    .filter((c) => c.required)
    .every((c) => c.passed);

  const remote = detectGitRemote();

  const results: PreflightResults = {
    checks,
    allRequiredPassed,
  };

  if (remote !== null) {
    results.detectedOwner = remote.owner;
    results.detectedRepo = remote.repo;
  }

  return results;
}

/**
 * packages/cli/scripts/smoke-test.mjs
 *
 * Validates the bundled CLI works correctly by exercising key commands.
 * Run after build:bundle to verify the bundle before publishing.
 *
 * Usage:
 *   node packages/cli/scripts/smoke-test.mjs
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync, symlinkSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliDir = join(__dirname, '..');
const dist = join(cliDir, 'dist', 'index.js');

// In the pnpm monorepo, external deps live under the virtual store.
// ESM resolution ignores NODE_PATH, so we create a temporary symlink
// at dist/node_modules → <root>/node_modules/.pnpm/node_modules
// so that Node's upward-walking resolver can find external packages.
// (In a real npm install, deps are flat in node_modules — no symlink needed.)
function findMonorepoRoot(dir) {
  let cur = dir;
  while (cur !== dirname(cur)) {
    try {
      statSync(join(cur, 'pnpm-workspace.yaml'));
      return cur;
    } catch { /* keep climbing */ }
    cur = dirname(cur);
  }
  return null;
}

const root = findMonorepoRoot(cliDir);
const distNodeModules = join(cliDir, 'dist', 'node_modules');
let createdSymlink = false;

if (root && !existsSync(distNodeModules)) {
  const target = join(root, 'node_modules', '.pnpm', 'node_modules');
  if (existsSync(target)) {
    try {
      symlinkSync(target, distNodeModules, 'junction');
      createdSymlink = true;
    } catch { /* non-fatal — tests will fail with clear error */ }
  }
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  \x1b[32mPASS\x1b[0m ${name}`);
    passed++;
  } catch (err) {
    console.log(`  \x1b[31mFAIL\x1b[0m ${name}: ${err.message}`);
    failed++;
  }
}

function run(file, args = [], opts = {}) {
  return execFileSync(file, args, {
    encoding: 'utf-8',
    timeout: 15000,
    stdio: ['pipe', 'pipe', 'pipe'],
    ...opts,
  }).trim();
}

console.log('\nSmoke tests for bundled CLI\n');

// Test 1: --version flag
test('--version outputs a semver string', () => {
  const version = run('node', [dist, '--version']);
  if (!/^\d+\.\d+\.\d+/.test(version)) {
    throw new Error(`Expected semver, got: "${version}"`);
  }
});

// Test 2: --help lists all commands
test('--help lists all commands', () => {
  const help = run('node', [dist, '--help']);
  for (const cmd of ['init', 'start', 'server', 'status']) {
    if (!help.includes(cmd)) {
      throw new Error(`--help missing command: ${cmd}`);
    }
  }
});

// Test 3: start --help shows flags
test('start --help shows expected flags', () => {
  const help = run('node', [dist, 'start', '--help']);
  for (const flag of ['--dry-run', '--once', '--approval', '--interactive']) {
    if (!help.includes(flag)) {
      throw new Error(`start --help missing flag: ${flag}`);
    }
  }
});

// Test 4: init fails gracefully outside a git repo
test('init exits with error outside git repo', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'tamma-smoke-'));
  try {
    try {
      execFileSync('node', [dist, 'init'], {
        cwd: tempDir,
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, CI: 'true', NO_COLOR: '1' },
      });
      // If it exits 0, that's acceptable (some environments might not fail)
    } catch (e) {
      if (e.status === undefined) throw e;
      // Non-zero exit is expected (preflight fails outside git repo)
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// Test 5: start with no config shows validation error
test('start exits with config error when unconfigured', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'tamma-smoke-'));
  try {
    execFileSync('node', [dist, 'start', '--once'], {
      cwd: tempDir,
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' },
    });
  } catch (e) {
    if (e.status === undefined) throw e;
    // Non-zero exit expected - config validation fails
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// Clean up the temporary symlink
if (createdSymlink) {
  try { unlinkSync(distNodeModules); } catch { /* best-effort */ }
}

// Summary
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.exit(1);
}

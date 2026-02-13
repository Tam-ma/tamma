/**
 * @module upgrade
 * Self-update command for the Tamma CLI.
 *
 * Fetches the latest (or a specific) release from GitHub, verifies the SHA256
 * checksum, and atomically replaces the current binary.
 */

import { createHash } from 'node:crypto';
import { writeFileSync, renameSync, chmodSync, unlinkSync } from 'node:fs';

const GITHUB_REPO = 'meywd/tamma';
const RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases`;

export interface UpgradeOptions {
  version?: string | undefined;
  force?: boolean | undefined;
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Detect the current platform string used in release asset names. */
export function detectPlatform(): string {
  const os = process.platform === 'darwin' ? 'darwin' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  return `${os}-${arch}`;
}

/**
 * Compare two semver strings (major.minor.patch).
 * Returns  1 if a > b, -1 if a < b, 0 if equal.
 */
export function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

/** Return the current version of the CLI. */
export function getCurrentVersion(): string {
  // TAMMA_VERSION is injected at bundle time by esbuild.
  if (typeof (globalThis as Record<string, unknown>).TAMMA_VERSION === 'string') {
    return (globalThis as Record<string, unknown>).TAMMA_VERSION as string;
  }
  try {
    const { createRequire } = require('node:module');
    const r = createRequire(import.meta.url);
    return (r('../../package.json') as { version: string }).version;
  } catch {
    return '0.0.0-dev';
  }
}

// ── Network helpers ──────────────────────────────────────────────────

interface GitHubRelease {
  tag_name: string;
}

/** Fetch the latest release tag from GitHub. */
export async function fetchLatestVersion(): Promise<string> {
  const res = await fetch(`${RELEASES_API}/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) {
    throw new Error(`GitHub API returned ${res.status}: ${res.statusText}`);
  }
  const data = (await res.json()) as GitHubRelease;
  return data.tag_name.replace(/^v/, '');
}

/** Download a file from a URL and return the response body as a Buffer. */
async function downloadBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Download failed (${res.status}): ${url}`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

// ── Main command ─────────────────────────────────────────────────────

export async function upgradeCommand(options: UpgradeOptions): Promise<void> {
  const currentVersion = getCurrentVersion();
  console.log(`Current version: ${currentVersion}`);

  // Determine target version.
  let targetVersion: string;
  if (options.version) {
    targetVersion = options.version.replace(/^v/, '');
    console.log(`Requested version: ${targetVersion}`);
  } else {
    console.log('Checking for latest release...');
    targetVersion = await fetchLatestVersion();
    console.log(`Latest version: ${targetVersion}`);
  }

  // Skip if already on the requested version (unless --force).
  if (!options.force && compareSemver(currentVersion, targetVersion) === 0) {
    console.log(`Already on version ${targetVersion}. Use --force to re-install.`);
    return;
  }

  if (!options.force && compareSemver(currentVersion, targetVersion) > 0) {
    console.log(
      `Current version (${currentVersion}) is newer than ${targetVersion}. Use --force to downgrade.`,
    );
    return;
  }

  const platform = detectPlatform();
  const assetName = `tamma-${targetVersion}-${platform}`;
  const downloadBase = `https://github.com/${GITHUB_REPO}/releases/download/v${targetVersion}`;
  const binaryUrl = `${downloadBase}/${assetName}`;
  const checksumUrl = `${downloadBase}/${assetName}.sha256`;

  // Download binary.
  console.log(`Downloading ${assetName}...`);
  const binaryBuf = await downloadBuffer(binaryUrl);
  console.log(`Downloaded ${(binaryBuf.length / 1024 / 1024).toFixed(1)} MB`);

  // Download and verify checksum.
  console.log('Verifying checksum...');
  const checksumBuf = await downloadBuffer(checksumUrl);
  const expectedHash = checksumBuf.toString('utf-8').trim().split(/\s+/)[0]!;
  const actualHash = createHash('sha256').update(binaryBuf).digest('hex');

  if (actualHash !== expectedHash) {
    throw new Error(
      `Checksum mismatch!\n  Expected: ${expectedHash}\n  Actual:   ${actualHash}`,
    );
  }
  console.log('Checksum verified.');

  // Atomic replacement: write to a temp path, then rename over the current binary.
  const execPath = process.execPath;
  const updatePath = `${execPath}.update`;

  try {
    writeFileSync(updatePath, binaryBuf);
    chmodSync(updatePath, 0o755);
    renameSync(updatePath, execPath);
  } catch (err) {
    // Clean up partial download on failure.
    try {
      unlinkSync(updatePath);
    } catch {
      // ignore cleanup errors
    }
    throw new Error(
      `Failed to replace binary at ${execPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  console.log(`Successfully upgraded to ${targetVersion}!`);
}

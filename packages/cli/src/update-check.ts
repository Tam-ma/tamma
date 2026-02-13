/**
 * @module update-check
 * Non-blocking background update checker.
 *
 * Checks GitHub for the latest release at most once every 24 hours,
 * caches the result in ~/.local/state/tamma/update-check.json, and
 * returns a human-readable message when a newer version is available.
 *
 * This module is designed to NEVER throw — every code path is wrapped
 * in try/catch so it can be called fire-and-forget without risk.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const GITHUB_REPO = 'meywd/tamma';
const RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FETCH_TIMEOUT_MS = 3_000;

interface UpdateCheckState {
  lastCheck: number;
  latestVersion: string;
}

/** Return the path to the state file. */
export function stateFilePath(): string {
  return join(homedir(), '.local', 'state', 'tamma', 'update-check.json');
}

/** Read the cached state file, or return null if it doesn't exist / is corrupt. */
function readState(path: string): UpdateCheckState | null {
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as UpdateCheckState;
    if (typeof parsed.lastCheck === 'number' && typeof parsed.latestVersion === 'string') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/** Persist state to disk. */
function writeState(path: string, state: UpdateCheckState): void {
  try {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, JSON.stringify(state, null, 2) + '\n');
  } catch {
    // Silently ignore — this is a best-effort cache.
  }
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

/**
 * Check whether a newer version of Tamma is available.
 *
 * - Returns a human-readable message string if an update exists.
 * - Returns `null` if already on latest or if the check was skipped / failed.
 * - **Never throws.**
 */
export async function checkForUpdates(currentVersion: string): Promise<string | null> {
  try {
    const filePath = stateFilePath();
    const now = Date.now();
    const cached = readState(filePath);

    // If we checked recently, use the cached version.
    if (cached !== null && now - cached.lastCheck < CHECK_INTERVAL_MS) {
      if (compareSemver(cached.latestVersion, currentVersion) > 0) {
        return `Update available: ${currentVersion} \u2192 ${cached.latestVersion}. Run: tamma upgrade`;
      }
      return null;
    }

    // Fetch latest release with a short timeout.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let latestVersion: string;
    try {
      const res = await fetch(RELEASES_API, {
        headers: { Accept: 'application/vnd.github+json' },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return null;
      const data = (await res.json()) as { tag_name: string };
      latestVersion = data.tag_name.replace(/^v/, '');
    } catch {
      clearTimeout(timer);
      return null;
    }

    // Persist.
    writeState(filePath, { lastCheck: now, latestVersion });

    if (compareSemver(latestVersion, currentVersion) > 0) {
      return `Update available: ${currentVersion} \u2192 ${latestVersion}. Run: tamma upgrade`;
    }

    return null;
  } catch {
    // Absolute safety net — never throw.
    return null;
  }
}

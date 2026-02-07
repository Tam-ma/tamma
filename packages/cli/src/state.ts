import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { EngineState, IssueData } from '@tamma/shared';
import type { EngineStats } from '@tamma/orchestrator';

/** Data persisted to the lockfile for cross-process status queries. */
export interface LockfileData {
  pid: number;
  state: EngineState;
  issue: { number: number; title: string } | null;
  startedAt: number;
  stats: EngineStats;
  updatedAt: number;
}

const LOCKFILE_DIR = path.join(os.homedir(), '.tamma');
const LOCKFILE_PATH = path.join(LOCKFILE_DIR, 'engine.lock');

export function getLockfilePath(): string {
  return LOCKFILE_PATH;
}

/**
 * Write/update the lockfile. Called on every state change from the engine.
 */
export function writeLockfile(
  state: EngineState,
  issue: IssueData | null,
  stats: EngineStats,
): void {
  fs.mkdirSync(LOCKFILE_DIR, { recursive: true });

  const data: LockfileData = {
    pid: process.pid,
    state,
    issue: issue !== null ? { number: issue.number, title: issue.title } : null,
    startedAt: stats.startedAt,
    stats,
    updatedAt: Date.now(),
  };

  fs.writeFileSync(LOCKFILE_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Read the lockfile. Returns null if it doesn't exist or is invalid.
 */
export function readLockfile(): LockfileData | null {
  if (!fs.existsSync(LOCKFILE_PATH)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(LOCKFILE_PATH, 'utf-8');
    return JSON.parse(raw) as LockfileData;
  } catch {
    return null;
  }
}

/**
 * Remove the lockfile. Called when the engine stops.
 */
export function removeLockfile(): void {
  try {
    fs.unlinkSync(LOCKFILE_PATH);
  } catch {
    // Ignore if already removed
  }
}

/**
 * Check if the PID in the lockfile is still running.
 */
export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

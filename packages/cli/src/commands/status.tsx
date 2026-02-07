import { readLockfile, isProcessRunning, getLockfilePath } from '../state.js';

export function statusCommand(): void {
  const lockfile = readLockfile();

  if (lockfile === null) {
    console.log('Tamma Engine: NOT RUNNING');
    console.log(`  (no lockfile at ${getLockfilePath()})`);
    return;
  }

  const running = isProcessRunning(lockfile.pid);

  if (!running) {
    console.log('Tamma Engine: NOT RUNNING (stale lockfile)');
    console.log(`  PID ${lockfile.pid} is no longer running`);
    return;
  }

  const uptime = formatDuration(Date.now() - lockfile.startedAt);
  const lastUpdate = formatDuration(Date.now() - lockfile.updatedAt);

  console.log(`Tamma Engine: RUNNING (PID ${lockfile.pid})`);
  console.log(`  State:      ${lockfile.state}`);

  if (lockfile.issue !== null) {
    console.log(`  Issue:      #${lockfile.issue.number} — ${lockfile.issue.title}`);
  }

  console.log(`  Uptime:     ${uptime}`);
  console.log(`  Processed:  ${lockfile.stats.issuesProcessed} issues`);
  console.log(`  Total Cost: $${lockfile.stats.totalCostUsd.toFixed(2)}`);
  console.log(`  Last Update: ${lastUpdate} ago`);
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000) % 60;
  const minutes = Math.floor(ms / 60_000) % 60;
  const hours = Math.floor(ms / 3_600_000);

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

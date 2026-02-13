import { readLockfile, isProcessRunning, getLockfilePath, removeLockfile } from '../state.js';
import { formatDuration } from '../utils.js';

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
    removeLockfile();
    console.log(`  Stale lockfile removed.`);
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

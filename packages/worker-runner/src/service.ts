import { rmSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { createRuntime } from './runtime.js';

export async function serve(sentinel = '/tmp/tamma-engine-healthy', create = createRuntime) {
  const stop = new AbortController();
  function shutdown() {
    rmSync(sentinel, { force: true });
    stop.abort();
  }
  rmSync(sentinel, { force: true });
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  try {
    const runtime = await create(false, stop.signal);
    try {
      await runtime.engine.initialize();
      if (stop.signal.aborted) return;
      writeFileSync(sentinel, String(Date.now()));
      while (!stop.signal.aborted) {
        try {
          await runtime.engine.processOneIssue();
        } catch {
          console.error('Issue processing failed');
        }
        if (!stop.signal.aborted) {
          try {
            await sleep(runtime.pollInterval, undefined, { signal: stop.signal });
          } catch (error) {
            if (!stop.signal.aborted) throw error;
          }
        }
      }
    } finally {
      rmSync(sentinel, { force: true });
      await runtime.dispose();
    }
  } finally {
    process.off('SIGTERM', shutdown);
    process.off('SIGINT', shutdown);
  }
}

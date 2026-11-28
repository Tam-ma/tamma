import { IssueUnavailableError } from '@tamma/orchestrator';
import { createRuntime } from './runtime.js';

export async function dispatch(env = process.env, create = createRuntime) {
  const id = env.TAMMA_WORKFLOW_ID;
  const installationId = env.TAMMA_INSTALLATION_ID;
  const issueNumber = Number(env.TAMMA_ISSUE_NUMBER);
  async function report(endpoint: 'result' | 'status', body: Record<string, unknown>) {
    if (!id) return;
    const url = new URL(
      `/api/v1/workflows/${encodeURIComponent(id)}/${endpoint}`,
      env.TAMMA_API_URL
    );
    try {
      const response = await fetch(url, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        headers: {
          Authorization: `Bearer ${env.TAMMA_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error();
    } catch {
      console.error(`Workflow ${endpoint} callback failed`);
    }
  }
  if (id && (!env.TAMMA_API_KEY || !env.TAMMA_API_URL))
    throw new Error('Missing callback credentials');
  const started = Date.now();
  let status: 'completed' | 'cancelled' | 'failed' = 'failed';
  let costUsd: number | undefined;
  const stop = new AbortController();
  const cancel = () => stop.abort();
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);
  try {
    if (
      !/^[1-9]\d*$/.test(installationId ?? '') ||
      installationId !== env.TAMMA_TOKEN_INSTALLATION_ID ||
      !Number.isSafeInteger(issueNumber) ||
      issueNumber <= 0
    )
      throw new Error('Invalid dispatch');
    await report('status', { status: 'running', step: 'initializing' });
    const runtime = await create(true, stop.signal);
    try {
      await runtime.engine.initialize();
      await report('status', { status: 'running', step: 'processing' });
      await runtime.engine.processOneIssue(issueNumber);
      costUsd = runtime.engine.getStats().totalCostUsd;
    } finally {
      await runtime.dispose();
    }
    status = stop.signal.aborted ? 'cancelled' : 'completed';
  } catch (error) {
    if (stop.signal.aborted || error instanceof IssueUnavailableError) status = 'cancelled';
    else console.error('Worker dispatch failed');
  } finally {
    process.off('SIGINT', cancel);
    process.off('SIGTERM', cancel);
  }
  await report('result', {
    status,
    duration: Date.now() - started,
    result: { issueNumber, installationId, costUsd },
    ...(status === 'failed' ? { error: 'Worker dispatch failed' } : {}),
  });
  return status === 'completed' ? 0 : status === 'cancelled' ? 78 : 1;
}

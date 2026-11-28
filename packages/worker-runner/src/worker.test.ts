import { mkdtempSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatch } from './dispatch.js';
import { serve } from './service.js';
import { workerLogger } from './runtime.js';

const env = {
  TAMMA_INSTALLATION_ID: '321',
  TAMMA_TOKEN_INSTALLATION_ID: '321',
  TAMMA_ISSUE_NUMBER: '17',
  TAMMA_WORKFLOW_ID: '494e0b02-03b8-4d35-9b9d-be13e681c822',
  TAMMA_API_KEY: 'callback-secret',
  TAMMA_API_URL: 'https://api.example',
  CALLBACK_URL: 'https://untrusted.example',
};

function fixture() {
  const engine = {
    initialize: vi.fn(),
    processOneIssue: vi.fn(),
    getStats: () => ({ totalCostUsd: 1 }),
  };
  const runtime = { engine, dispose: vi.fn(), pollInterval: 60_000 };
  return { engine, runtime, create: vi.fn().mockResolvedValue(runtime) };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('worker dispatch', () => {
  it.each(['completed', 'failed', 'mismatch'] as const)(
    'reports %s exactly once',
    async (outcome) => {
      const { engine, create, runtime } = fixture();
      const fetch = vi.fn().mockResolvedValue(new Response('callback-secret', { status: 502 }));
      vi.stubGlobal('fetch', fetch);
      const logs = vi.spyOn(console, 'error').mockImplementation(() => {});
      if (outcome === 'failed')
        engine.processOneIssue.mockRejectedValue(new Error('callback-secret'));
      const inputs = {
        ...env,
        TAMMA_TOKEN_INSTALLATION_ID: outcome === 'mismatch' ? '322' : '321',
      };
      expect(await dispatch(inputs, create)).toBe(outcome === 'completed' ? 0 : 1);
      if (outcome === 'mismatch') expect(create).not.toHaveBeenCalled();
      else {
        expect(engine.processOneIssue).toHaveBeenCalledWith(17);
        expect(runtime.dispose).toHaveBeenCalledOnce();
        expect(fetch.mock.calls.slice(0, 2).map(([, init]) => JSON.parse(init.body).step)).toEqual([
          'initializing',
          'processing',
        ]);
      }
      const terminal = fetch.mock.calls.filter(([url]) => url.pathname.endsWith('/result'));
      expect(terminal).toHaveLength(1);
      const [url, init] = terminal[0]!;
      expect(url.href).toBe(
        `${env.TAMMA_API_URL}/api/v1/workflows/${env.TAMMA_WORKFLOW_ID}/result`
      );
      expect(init.headers.Authorization).toBe('Bearer callback-secret');
      expect(JSON.parse(init.body)).toMatchObject({
        status: outcome === 'completed' ? outcome : 'failed',
        result: { issueNumber: 17, installationId: '321' },
      });
      expect(JSON.stringify(logs.mock.calls)).not.toContain('callback-secret');
    }
  );

  it('processes an untracked dispatch without callbacks', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await dispatch({ ...env, TAMMA_WORKFLOW_ID: '' }, fixture().create)).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('leaves the terminal callback to the runner in the checked-in workflow', () => {
    const workflow = readFileSync(
      new URL('../../../.github/workflows/tamma-worker.yml', import.meta.url),
      'utf8'
    );
    expect(workflow).toContain('steps.app-token.outputs.installation-id');
    expect(workflow).toContain('worker-runner/dist/index.js process-issue');
    expect(workflow).not.toMatch(/\/result|Report Result|if: always\(\)/);
  });
});

it('redacts credentials in engine messages and nested SDK context', () => {
  const sink = vi.fn();
  const logger = workerLogger({ debug: sink, info: sink, warn: sink, error: sink }, [
    'callback-secret',
  ]);
  logger.error('Rejected callback-secret', {
    headers: { Authorization: 'unlisted-secret' },
    detail: ['callback-secret'],
  });
  expect(JSON.stringify(sink.mock.calls)).not.toMatch(/callback-secret|unlisted-secret/);
});

it('clears stale readiness on startup failure, then handles SIGTERM during a poll', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'worker-test-'));
  const file = join(dir, 'health');
  try {
    writeFileSync(file, 'stale');
    vi.stubEnv('GITHUB_TOKEN', '');
    vi.stubEnv('TAMMA_GITHUB_OWNER', '');
    vi.stubEnv('TAMMA_GITHUB_AUTH_MODE', 'pat');
    await expect(serve(file)).rejects.toThrow('Incomplete worker repository credentials');
    expect(existsSync(file)).toBe(false);
    const { engine, runtime, create } = fixture();
    engine.initialize.mockImplementation(() => expect(existsSync(file)).toBe(false));
    const running = serve(file, create);
    await vi.waitFor(() => expect(engine.processOneIssue).toHaveBeenCalledOnce());
    expect(existsSync(file)).toBe(true);
    process.emit('SIGTERM');
    expect(existsSync(file)).toBe(false);
    await running;
    expect(runtime.dispose).toHaveBeenCalledOnce();
  } finally {
    rmSync(dir, { recursive: true });
  }
});

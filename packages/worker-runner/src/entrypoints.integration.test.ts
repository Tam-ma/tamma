import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

// Exercise the built entry point just as a workflow in a separate tenant checkout does.
it('uses the installation token for the named issue and reports a skipped job to the API', async () => {
  const calls: { path: string; auth?: string; body: string }[] = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    calls.push({ path: req.url!, auth: req.headers.authorization, body });
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify(
        req.url?.endsWith('/comments?per_page=100') ? [] : { number: 17, state: 'closed' }
      )
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP fixture');
  const origin = `http://127.0.0.1:${address.port}`;
  const cwd = mkdtempSync(join(tmpdir(), 'tenant-checkout-'));
  try {
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL('../dist/index.js', import.meta.url)), 'process-issue'],
      {
        cwd,
        env: {
          NODE_ENV: 'production',
          OPENSEARCH_ENABLED: 'false',
          PATH: process.env.PATH,
          TAMMA_INSTALLATION_ID: '321',
          TAMMA_TOKEN_INSTALLATION_ID: '321',
          TAMMA_ISSUE_NUMBER: '17',
          GITHUB_TOKEN: 'fixture-installation-token',
          GITHUB_API_URL: origin,
          GITHUB_REPOSITORY: 'tenant/project',
          TAMMA_GITHUB_OWNER: 'tenant',
          TAMMA_GITHUB_REPO: 'project',
          TAMMA_API_KEY: 'fixture-api-secret',
          TAMMA_WORKFLOW_ID: '494e0b02-03b8-4d35-9b9d-be13e681c822',
          TAMMA_API_URL: origin,
        },
      }
    );
    let logs = '';
    child.stdout.on('data', (chunk) => {
      logs += chunk;
    });
    child.stderr.on('data', (chunk) => {
      logs += chunk;
    });
    expect((await once(child, 'close'))[0], logs).toBe(78);
    const github = calls.filter((call) => call.path.startsWith('/repos'));
    expect(github.map((call) => call.path)).toEqual([
      '/repos/tenant/project/issues/17',
      '/repos/tenant/project/issues/17/comments?per_page=100',
    ]);
    expect(github.every((call) => call.auth?.endsWith('fixture-installation-token'))).toBe(true);
    const api = calls.filter((call) => call.path.startsWith('/api/v1/workflows/'));
    expect(api.every((call) => call.auth === 'Bearer fixture-api-secret')).toBe(true);
    expect(api.map((call) => JSON.parse(call.body).status)).toEqual([
      'running',
      'running',
      'cancelled',
    ]);
    expect(JSON.parse(api[2]!.body).result).toEqual({ installationId: '321', issueNumber: 17 });
    expect(logs).not.toMatch(/fixture-installation-token|fixture-api-secret/);
  } finally {
    server.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});

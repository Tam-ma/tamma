/**
 * GitHub Webhook Handler Tests
 *
 * Tests for multi-tenant webhook handling:
 * - installationId extraction and tagging on task payloads
 * - SaaS mode: missing installationId returns 400
 * - Installation lifecycle events (created, deleted, suspend, unsuspend)
 * - Actionable events enqueue tasks with correct installationId
 * - Cache invalidation on installation deletion
 */

import { createHmac } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerGitHubWebhookRoute } from './github-webhook.js';
import { InMemoryInstallationStore } from '../../persistence/installation-store.js';
import { InMemoryTaskQueue } from '../../services/in-memory-task-queue.js';
import { InstallationRouter } from '../../services/installation-router.js';

const WEBHOOK_SECRET = 'test-webhook-secret';
const APP_ID = 12345;

function sign(payload: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');
}

function buildWebhookRequest(
  app: FastifyInstance,
  event: string,
  payload: Record<string, unknown>,
) {
  const body = JSON.stringify(payload);
  return app.inject({
    method: 'POST',
    url: '/api/github/webhooks',
    headers: {
      'x-hub-signature-256': sign(body, WEBHOOK_SECRET),
      'x-github-event': event,
      'content-type': 'application/json',
    },
    payload: body,
  });
}

// -------------------------------------------------------------------------
// Standard mode (self-hosted compatible)
// -------------------------------------------------------------------------

describe('GitHub Webhook Handler', () => {
  let app: FastifyInstance;
  let installationStore: InMemoryInstallationStore;
  let taskQueue: InMemoryTaskQueue;
  let installationRouter: InstallationRouter;

  beforeAll(async () => {
    installationStore = new InMemoryInstallationStore();
    taskQueue = new InMemoryTaskQueue();
    installationRouter = new InstallationRouter(installationStore);

    app = Fastify({ logger: false });
    await registerGitHubWebhookRoute(app, {
      webhookSecret: WEBHOOK_SECRET,
      appId: APP_ID,
      installationStore,
      taskQueue,
      installationRouter,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    taskQueue.clear();
  });

  // -----------------------------------------------------------------------
  // Signature verification
  // -----------------------------------------------------------------------

  describe('signature verification', () => {
    it('rejects requests without x-hub-signature-256', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/github/webhooks',
        headers: { 'x-github-event': 'ping', 'content-type': 'application/json' },
        payload: JSON.stringify({}),
      });
      expect(response.statusCode).toBe(401);
    });

    it('rejects requests with invalid signature', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/github/webhooks',
        headers: {
          'x-hub-signature-256': 'sha256=invalidsignature',
          'x-github-event': 'ping',
          'content-type': 'application/json',
        },
        payload: JSON.stringify({}),
      });
      expect(response.statusCode).toBe(401);
    });
  });

  // -----------------------------------------------------------------------
  // installationId extraction and tagging
  // -----------------------------------------------------------------------

  describe('installationId tagging', () => {
    it('extracts installationId from webhook payload and includes in task', async () => {
      const payload = {
        action: 'opened',
        installation: { id: 7777 },
        repository: { id: 1, full_name: 'org/repo' },
        issue: { number: 1 },
      };

      const response = await buildWebhookRequest(app, 'issues', payload);
      expect(response.statusCode).toBe(200);

      const tasks = await taskQueue.list();
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.installationId).toBe(7777);
      expect(tasks[0]!.type).toBe('github.issues.opened');
      expect(tasks[0]!.payload['installationId']).toBe(7777);
    });

    it('handles webhooks without installation object (self-hosted)', async () => {
      const payload = {
        action: 'opened',
        repository: { id: 1, full_name: 'org/repo' },
        issue: { number: 1 },
      };

      const response = await buildWebhookRequest(app, 'issues', payload);
      expect(response.statusCode).toBe(200);

      const tasks = await taskQueue.list();
      expect(tasks).toHaveLength(1);
      // installationId should be undefined (not set)
      expect(tasks[0]!.payload['installationId']).toBeUndefined();
    });

    it('includes installationId in pull_request task payloads', async () => {
      const payload = {
        action: 'opened',
        installation: { id: 8888 },
        repository: { id: 2, full_name: 'org/repo2' },
        pull_request: { number: 10 },
      };

      const response = await buildWebhookRequest(app, 'pull_request', payload);
      expect(response.statusCode).toBe(200);

      const tasks = await taskQueue.list();
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.installationId).toBe(8888);
      expect(tasks[0]!.type).toBe('github.pull_request.opened');
    });

    it('includes installationId in push task payloads', async () => {
      const payload = {
        ref: 'refs/heads/main',
        installation: { id: 9999 },
        repository: { id: 3, full_name: 'org/repo3' },
      };

      const response = await buildWebhookRequest(app, 'push', payload);
      expect(response.statusCode).toBe(200);

      const tasks = await taskQueue.list();
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.installationId).toBe(9999);
      expect(tasks[0]!.type).toBe('github.push.unknown');
    });
  });

  // -----------------------------------------------------------------------
  // Installation lifecycle
  // -----------------------------------------------------------------------

  describe('installation lifecycle events', () => {
    it('stores new installation on installation.created', async () => {
      const payload = {
        action: 'created',
        installation: {
          id: 5001,
          account: { login: 'test-org', type: 'Organization' },
          permissions: { issues: 'write' },
        },
        repositories: [
          { id: 100, name: 'repo-a', full_name: 'test-org/repo-a' },
        ],
      };

      const response = await buildWebhookRequest(app, 'installation', payload);
      expect(response.statusCode).toBe(200);

      const stored = await installationStore.getInstallation(5001);
      expect(stored).not.toBeNull();
      expect(stored!.accountLogin).toBe('test-org');
    });

    it('removes installation on installation.deleted', async () => {
      // First create
      await installationStore.upsertInstallation({
        installationId: 5002,
        accountLogin: 'to-delete',
        accountType: 'User',
        appId: APP_ID,
        permissions: {},
        suspendedAt: null,
      });

      const payload = {
        action: 'deleted',
        installation: { id: 5002, account: { login: 'to-delete', type: 'User' } },
      };

      const response = await buildWebhookRequest(app, 'installation', payload);
      expect(response.statusCode).toBe(200);

      const stored = await installationStore.getInstallation(5002);
      expect(stored).toBeNull();
    });

    it('invalidates cache on installation.deleted', async () => {
      await installationStore.upsertInstallation({
        installationId: 5003,
        accountLogin: 'cached-org',
        accountType: 'Organization',
        appId: APP_ID,
        permissions: {},
        suspendedAt: null,
      });

      // Warm the cache
      await installationRouter.resolve(5003);
      expect(installationRouter.cacheSize).toBeGreaterThan(0);

      const payload = {
        action: 'deleted',
        installation: { id: 5003, account: { login: 'cached-org', type: 'Organization' } },
      };

      await buildWebhookRequest(app, 'installation', payload);

      // After deletion, resolving should return null (cache was invalidated)
      const result = await installationRouter.resolve(5003);
      expect(result).toBeNull();
    });

    it('suspends installation on installation.suspend', async () => {
      await installationStore.upsertInstallation({
        installationId: 5004,
        accountLogin: 'suspend-org',
        accountType: 'Organization',
        appId: APP_ID,
        permissions: {},
        suspendedAt: null,
      });

      const payload = {
        action: 'suspend',
        installation: { id: 5004, account: { login: 'suspend-org', type: 'Organization' } },
      };

      const response = await buildWebhookRequest(app, 'installation', payload);
      expect(response.statusCode).toBe(200);

      const stored = await installationStore.getInstallation(5004);
      expect(stored!.suspendedAt).not.toBeNull();
    });

    it('unsuspends installation on installation.unsuspend', async () => {
      await installationStore.upsertInstallation({
        installationId: 5005,
        accountLogin: 'unsuspend-org',
        accountType: 'Organization',
        appId: APP_ID,
        permissions: {},
        suspendedAt: null,
      });
      await installationStore.suspendInstallation(5005);

      const payload = {
        action: 'unsuspend',
        installation: { id: 5005, account: { login: 'unsuspend-org', type: 'Organization' } },
      };

      const response = await buildWebhookRequest(app, 'installation', payload);
      expect(response.statusCode).toBe(200);

      const stored = await installationStore.getInstallation(5005);
      expect(stored!.suspendedAt).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // No task queue configured
  // -----------------------------------------------------------------------

  describe('no task queue', () => {
    let noQueueApp: FastifyInstance;

    beforeAll(async () => {
      noQueueApp = Fastify({ logger: false });
      await registerGitHubWebhookRoute(noQueueApp, {
        webhookSecret: WEBHOOK_SECRET,
        appId: APP_ID,
        installationStore: new InMemoryInstallationStore(),
      });
      await noQueueApp.ready();
    });

    afterAll(async () => {
      await noQueueApp.close();
    });

    it('handles issue events without a task queue (no error)', async () => {
      const payload = {
        action: 'opened',
        installation: { id: 1 },
        issue: { number: 1 },
      };

      const response = await buildWebhookRequest(noQueueApp, 'issues', payload);
      expect(response.statusCode).toBe(200);
    });
  });
});

// -------------------------------------------------------------------------
// SaaS mode (requireInstallationId)
// -------------------------------------------------------------------------

describe('GitHub Webhook Handler - SaaS Mode', () => {
  let app: FastifyInstance;
  let installationStore: InMemoryInstallationStore;
  let taskQueue: InMemoryTaskQueue;

  beforeAll(async () => {
    installationStore = new InMemoryInstallationStore();
    taskQueue = new InMemoryTaskQueue();

    app = Fastify({ logger: false });
    await registerGitHubWebhookRoute(app, {
      webhookSecret: WEBHOOK_SECRET,
      appId: APP_ID,
      installationStore,
      taskQueue,
      requireInstallationId: true,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    taskQueue.clear();
  });

  it('rejects webhooks without installation.id with 400', async () => {
    const payload = {
      action: 'opened',
      issue: { number: 1 },
      repository: { id: 1, full_name: 'org/repo' },
    };

    const response = await buildWebhookRequest(app, 'issues', payload);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'Missing installation.id' });
  });

  it('rejects webhooks with null installation.id with 400', async () => {
    const payload = {
      action: 'opened',
      installation: { id: null },
      issue: { number: 1 },
    };

    const response = await buildWebhookRequest(app, 'issues', payload);
    expect(response.statusCode).toBe(400);
  });

  it('accepts webhooks with valid installation.id', async () => {
    const payload = {
      action: 'opened',
      installation: { id: 6001 },
      issue: { number: 1 },
    };

    const response = await buildWebhookRequest(app, 'issues', payload);
    expect(response.statusCode).toBe(200);

    const tasks = await taskQueue.list();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.installationId).toBe(6001);
  });

  it('allows installation events even in SaaS mode (they always have installation.id)', async () => {
    const payload = {
      action: 'created',
      installation: {
        id: 6002,
        account: { login: 'saas-org', type: 'Organization' },
        permissions: {},
      },
      repositories: [],
    };

    const response = await buildWebhookRequest(app, 'installation', payload);
    expect(response.statusCode).toBe(200);
  });
});

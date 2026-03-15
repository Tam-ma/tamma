/**
 * API Key Auth Middleware Tests
 *
 * Tests for valid key, invalid key, suspended installation, missing header.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerApiKeyAuthPlugin } from '../auth/api-key-auth.js';
import { generateApiKey, hashApiKey, getApiKeyPrefix } from '../auth/api-key.js';
import { InMemoryInstallationStore } from '../persistence/installation-store.js';

describe('API Key Auth Middleware', () => {
  let app: FastifyInstance;
  let store: InMemoryInstallationStore;
  let validKey: string;
  let validKeyHash: string;

  beforeEach(async () => {
    store = new InMemoryInstallationStore();

    // Set up a valid installation with API key
    validKey = generateApiKey();
    validKeyHash = hashApiKey(validKey);
    const validKeyPrefix = getApiKeyPrefix(validKey);

    await store.upsertInstallation({
      installationId: 123,
      accountLogin: 'test-org',
      accountType: 'Organization',
      appId: 1,
      permissions: { contents: 'read', issues: 'write' },
      suspendedAt: null,
      apiKeyHash: validKeyHash,
      apiKeyPrefix: validKeyPrefix,
      apiKeyEncrypted: null,
    });

    app = Fastify({ logger: false });

    // Register the auth plugin in a scoped context
    await app.register(
      async (instance) => {
        await instance.register(registerApiKeyAuthPlugin, {
          installationStore: store,
        });

        // Add a test route inside the scoped context
        instance.get('/api/v1/test', async (request) => {
          const ctx = (request as Record<string, unknown>)['installationContext'] as Record<string, unknown>;
          return { ok: true, installationId: ctx['installationId'] };
        });
      },
      { prefix: '' },
    );

    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('allows requests with a valid API key', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/test',
      headers: {
        authorization: `Bearer ${validKey}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.installationId).toBe(123);
  });

  it('rejects requests without Authorization header', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/test',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe('Missing or invalid Authorization header');
  });

  it('rejects requests with wrong Authorization scheme', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/test',
      headers: {
        authorization: 'Basic dXNlcjpwYXNz',
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe('Missing or invalid Authorization header');
  });

  it('rejects requests with invalid API key format', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/test',
      headers: {
        authorization: 'Bearer invalid-key-format',
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe('Invalid API key format');
  });

  it('rejects requests with wrong API key', async () => {
    const wrongKey = generateApiKey(); // Different key
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/test',
      headers: {
        authorization: `Bearer ${wrongKey}`,
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe('Invalid API key');
  });

  it('rejects requests for suspended installations', async () => {
    // Suspend the installation
    await store.suspendInstallation(123);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/test',
      headers: {
        authorization: `Bearer ${validKey}`,
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe('Installation is suspended');
  });

  it('decorates request with installationContext containing correct data', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/test',
      headers: {
        authorization: `Bearer ${validKey}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.installationId).toBe(123);
  });
});

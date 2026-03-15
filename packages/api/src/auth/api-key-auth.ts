/**
 * API Key Authentication Plugin for SaaS routes.
 *
 * Fastify plugin that:
 * 1. Extracts `Authorization: Bearer tamma_sk_...` header
 * 2. Hashes the key and looks up the installation via findByApiKeyHash
 * 3. Rejects suspended installations (403)
 * 4. Decorates request with installationContext
 */

import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { hashApiKey } from './api-key.js';
import type { IGitHubInstallationStore } from '../persistence/installation-store.js';

/** Context attached to request after successful API key authentication. */
export interface InstallationContext {
  installationId: number;
  accountLogin: string;
  permissions: Record<string, string>;
}

/** Options for the API key auth plugin. */
export interface ApiKeyAuthConfig {
  installationStore: IGitHubInstallationStore;
}

async function apiKeyAuthPlugin(
  fastify: FastifyInstance,
  opts: ApiKeyAuthConfig,
): Promise<void> {
  const { installationStore } = opts;

  // Decorate request with installationContext
  fastify.decorateRequest('installationContext', null);

  fastify.addHook(
    'onRequest',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const authHeader = request.headers.authorization;

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.status(401).send({ error: 'Missing or invalid Authorization header' });
      }

      const token = authHeader.slice('Bearer '.length);

      if (!token.startsWith('tamma_sk_')) {
        return reply.status(401).send({ error: 'Invalid API key format' });
      }

      const keyHash = hashApiKey(token);
      const installation = await installationStore.findByApiKeyHash(keyHash);

      if (!installation) {
        return reply.status(401).send({ error: 'Invalid API key' });
      }

      if (installation.suspendedAt !== null) {
        return reply.status(403).send({ error: 'Installation is suspended' });
      }

      // Decorate request with installation context
      (request as FastifyRequest & { installationContext: InstallationContext }).installationContext = {
        installationId: installation.installationId,
        accountLogin: installation.accountLogin,
        permissions: installation.permissions,
      };
    },
  );
}

export const registerApiKeyAuthPlugin = fp(apiKeyAuthPlugin, {
  name: 'tamma-api-key-auth',
});

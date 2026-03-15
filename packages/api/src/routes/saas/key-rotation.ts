/**
 * Key Rotation Route
 *
 * POST /api/v1/installations/:id/rotate-key — generates a new API key,
 * updates the database, and re-provisions to all repos associated with
 * the installation.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Octokit } from '@octokit/rest';
import { generateApiKey, hashApiKey, getApiKeyPrefix } from '../../auth/api-key.js';
import type { IGitHubInstallationStore } from '../../persistence/installation-store.js';
import { GitHubSecretsProvisioner } from '../../services/github-secrets-provisioner.js';

export interface KeyRotationRouteOptions {
  installationStore: IGitHubInstallationStore;
  /** Factory that creates an installation-scoped Octokit. */
  createOctokit: (installationId: number) => Promise<Octokit>;
}

export async function registerKeyRotationRoute(
  app: FastifyInstance,
  options: KeyRotationRouteOptions,
): Promise<void> {
  const provisioner = new GitHubSecretsProvisioner();

  app.post(
    '/api/v1/installations/:id/rotate-key',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const installationId = parseInt(request.params.id, 10);
      if (Number.isNaN(installationId)) {
        return reply.status(400).send({ error: 'Invalid installation ID' });
      }

      const installation = await options.installationStore.getInstallation(installationId);
      if (!installation) {
        return reply.status(404).send({ error: 'Installation not found' });
      }

      if (installation.suspendedAt !== null) {
        return reply.status(403).send({ error: 'Installation is suspended' });
      }

      // Generate new key
      const newKey = generateApiKey();
      const newHash = hashApiKey(newKey);
      const newPrefix = getApiKeyPrefix(newKey);

      // Update database
      await options.installationStore.updateApiKeyHash(installationId, newHash, newPrefix);

      // Re-provision to all repos
      const repos = await options.installationStore.listRepos(installationId);

      let provisionResults: Array<{ owner: string; repo: string; success: boolean; error?: string }> = [];
      try {
        const octokit = await options.createOctokit(installationId);
        provisionResults = await provisioner.provisionApiKey(
          octokit,
          repos.map((r) => ({ owner: r.owner, name: r.name })),
          newKey,
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        app.log.error({ msg: 'Failed to provision rotated key to repos', error: message, installationId });
        // Key is rotated in DB even if provisioning fails — user can retry
      }

      const successCount = provisionResults.filter((r) => r.success).length;
      const failureCount = provisionResults.filter((r) => !r.success).length;

      app.log.info({
        msg: 'API key rotated',
        installationId,
        keyPrefix: newPrefix,
        reposProvisioned: successCount,
        reposFailed: failureCount,
      });

      return reply.send({
        ok: true,
        installationId,
        keyPrefix: newPrefix,
        provisioning: {
          total: repos.length,
          success: successCount,
          failed: failureCount,
          results: provisionResults,
        },
      });
    },
  );
}

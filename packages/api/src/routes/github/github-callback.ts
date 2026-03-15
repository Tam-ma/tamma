/**
 * GitHub App installation callback handler.
 *
 * When a user installs the Tamma GitHub App, GitHub redirects to:
 *   GET /api/github/callback?installation_id=XXX&setup_action=install
 *
 * This handler:
 * 1. Uses the App JWT to fetch installation details from GitHub
 * 2. Stores the installation and its repos in the database
 * 3. Generates an API key, stores the hash, and provisions to all repos
 * 4. Redirects the user to the success page
 */

import type { FastifyInstance } from 'fastify';
import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import type { IGitHubInstallationStore } from '../../persistence/installation-store.js';
import { generateApiKey, hashApiKey, getApiKeyPrefix } from '../../auth/api-key.js';
import { GitHubSecretsProvisioner } from '../../services/github-secrets-provisioner.js';

export interface GitHubCallbackOptions {
  appId: number;
  privateKey: string;
  installationStore: IGitHubInstallationStore;
  successRedirectUrl: string;
}

export async function registerGitHubCallbackRoute(
  app: FastifyInstance,
  options: GitHubCallbackOptions,
): Promise<void> {
  const provisioner = new GitHubSecretsProvisioner();

  app.get<{
    Querystring: { installation_id?: string; setup_action?: string };
  }>('/api/github/callback', async (request, reply) => {
    const installationIdStr = request.query.installation_id;
    const setupAction = request.query.setup_action;

    if (!installationIdStr || !setupAction) {
      return reply.status(400).send({ error: 'Missing installation_id or setup_action' });
    }

    const installationId = parseInt(installationIdStr, 10);
    if (Number.isNaN(installationId)) {
      return reply.status(400).send({ error: 'Invalid installation_id' });
    }

    if (setupAction === 'install' || setupAction === 'update') {
      // Create an App-authenticated Octokit to fetch installation details
      const octokit = new Octokit({
        authStrategy: createAppAuth,
        auth: {
          appId: options.appId,
          privateKey: options.privateKey,
        },
      });

      try {
        // Fetch installation details
        const { data: installation } = await octokit.rest.apps.getInstallation({
          installation_id: installationId,
        });

        const account = installation.account;
        const accountLogin = account && 'login' in account ? (account.login ?? 'unknown') : 'unknown';
        const accountType = account && 'type' in account ? (account.type ?? 'User') : 'User';

        // Store installation
        await options.installationStore.upsertInstallation({
          installationId,
          accountLogin,
          accountType: accountType as 'User' | 'Organization',
          appId: options.appId,
          permissions: (installation.permissions ?? {}) as Record<string, string>,
          suspendedAt: installation.suspended_at ?? null,
          apiKeyHash: null,
          apiKeyPrefix: null,
          apiKeyEncrypted: null,
        });

        // Fetch and store repos for this installation
        const installationOctokit = new Octokit({
          authStrategy: createAppAuth,
          auth: {
            appId: options.appId,
            privateKey: options.privateKey,
            installationId,
          },
        });

        const { data: reposData } = await installationOctokit.rest.apps.listReposAccessibleToInstallation({
          per_page: 100,
        });

        const repos = reposData.repositories.map((repo) => ({
          repoId: repo.id,
          owner: repo.owner.login,
          name: repo.name,
          fullName: repo.full_name,
        }));

        await options.installationStore.setRepos(installationId, repos);

        // Generate and provision API key
        const apiKey = generateApiKey();
        const apiKeyHash = hashApiKey(apiKey);
        const apiKeyPrefix = getApiKeyPrefix(apiKey);

        await options.installationStore.updateApiKeyHash(installationId, apiKeyHash, apiKeyPrefix);

        // Provision API key as GitHub Actions secret to all repos
        if (repos.length > 0) {
          try {
            const provisionResults = await provisioner.provisionApiKey(
              installationOctokit,
              repos.map((r) => ({ owner: r.owner, name: r.name })),
              apiKey,
            );

            const successCount = provisionResults.filter((r) => r.success).length;
            const failureCount = provisionResults.filter((r) => !r.success).length;

            app.log.info({
              msg: 'API key provisioned to repos',
              installationId,
              keyPrefix: apiKeyPrefix,
              reposProvisioned: successCount,
              reposFailed: failureCount,
            });

            if (failureCount > 0) {
              const failures = provisionResults.filter((r) => !r.success);
              app.log.warn({
                msg: 'Some repos failed API key provisioning',
                installationId,
                failures,
              });
            }
          } catch (err) {
            app.log.error({
              msg: 'Failed to provision API key to repos',
              error: err,
              installationId,
            });
            // Don't fail the callback — key is stored, provisioning can be retried
          }
        }

        app.log.info({
          msg: 'GitHub App installation stored',
          installationId,
          accountLogin,
          repoCount: repos.length,
        });
      } catch (err) {
        app.log.error({ msg: 'Failed to process GitHub callback', error: err, installationId });
        return reply.status(500).send({ error: 'Failed to process installation' });
      }
    }

    // Redirect to success page
    return reply.status(302).redirect(options.successRedirectUrl);
  });
}

/**
 * GitHub Secrets Provisioner
 *
 * Provisions TAMMA_API_KEY as a GitHub Actions secret to repos
 * associated with an installation, using libsodium sealed-box encryption.
 */

import type { Octokit } from '@octokit/rest';

/** Result of provisioning a secret to a single repo. */
export interface ProvisionResult {
  owner: string;
  repo: string;
  success: boolean;
  error?: string;
}

/** Public key response from GitHub Actions secrets API. */
interface RepoPublicKey {
  key_id: string;
  key: string;
}

/** Maximum number of concurrent secret writes. */
const MAX_CONCURRENCY = 5;

/**
 * Provisions GitHub Actions secrets to repositories using
 * libsodium sealed-box encryption.
 */
export class GitHubSecretsProvisioner {
  /**
   * Get a repo's public key for encrypting secrets.
   */
  async getRepoPublicKey(
    octokit: Octokit,
    owner: string,
    repo: string,
  ): Promise<RepoPublicKey> {
    const { data } = await octokit.rest.actions.getRepoPublicKey({
      owner,
      repo,
    });
    return { key_id: data.key_id, key: data.key };
  }

  /**
   * Encrypt a secret value using libsodium crypto_box_seal.
   *
   * @param publicKeyBase64 - The repo's public key (base64-encoded).
   * @param secretValue - The plaintext secret to encrypt.
   * @returns base64-encoded encrypted value.
   */
  async encryptSecret(publicKeyBase64: string, secretValue: string): Promise<string> {
    // Dynamic import to avoid bundling issues and allow libsodium to initialize
    const sodium = await import('libsodium-wrappers').then((m) => m.default ?? m);
    await sodium.ready;

    const publicKeyBytes = sodium.from_base64(publicKeyBase64, sodium.base64_variants.ORIGINAL);
    const messageBytes = sodium.from_string(secretValue);
    const encryptedBytes = sodium.crypto_box_seal(messageBytes, publicKeyBytes);
    return sodium.to_base64(encryptedBytes, sodium.base64_variants.ORIGINAL);
  }

  /**
   * Write a single secret to a repository.
   * Full flow: get public key, encrypt, PUT.
   */
  async writeSecret(
    octokit: Octokit,
    owner: string,
    repo: string,
    secretName: string,
    secretValue: string,
  ): Promise<void> {
    const publicKey = await this.getRepoPublicKey(octokit, owner, repo);
    const encryptedValue = await this.encryptSecret(publicKey.key, secretValue);

    await octokit.rest.actions.createOrUpdateRepoSecret({
      owner,
      repo,
      secret_name: secretName,
      encrypted_value: encryptedValue,
      key_id: publicKey.key_id,
    });
  }

  /**
   * Provision TAMMA_API_KEY to multiple repos (parallel, max 5 concurrent).
   *
   * Handles errors per-repo: skips archived repos, logs warnings, does not
   * fail the entire batch on individual failures.
   */
  async provisionApiKey(
    octokit: Octokit,
    repos: Array<{ owner: string; name: string }>,
    apiKey: string,
  ): Promise<ProvisionResult[]> {
    const results: ProvisionResult[] = [];

    // Process in batches of MAX_CONCURRENCY
    for (let i = 0; i < repos.length; i += MAX_CONCURRENCY) {
      const batch = repos.slice(i, i + MAX_CONCURRENCY);
      const batchResults = await Promise.allSettled(
        batch.map(async (repo) => {
          try {
            await this.writeSecret(octokit, repo.owner, repo.name, 'TAMMA_API_KEY', apiKey);
            return { owner: repo.owner, repo: repo.name, success: true } satisfies ProvisionResult;
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            // Check for archived repo or permission errors
            const isArchived = message.includes('archived');
            const errorMessage = isArchived
              ? `Skipped archived repo ${repo.owner}/${repo.name}`
              : `Failed to provision secret for ${repo.owner}/${repo.name}: ${message}`;
            return { owner: repo.owner, repo: repo.name, success: false, error: errorMessage } satisfies ProvisionResult;
          }
        }),
      );

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          // Should not happen since we catch errors above, but handle defensively
          results.push({
            owner: 'unknown',
            repo: 'unknown',
            success: false,
            error: String(result.reason),
          });
        }
      }
    }

    return results;
  }
}

/**
 * GitHub Secrets Provisioner Tests
 *
 * Tests for encryption, provisioning, and error handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubSecretsProvisioner } from '../services/github-secrets-provisioner.js';

// Valid Curve25519 public key for testing (base64-encoded, 32 bytes)
const TEST_PUBLIC_KEY = 'ug/7DBrOP4EIKNbrqwfx5OtBw1eSrkQOrAQVtOTh8kc=';

// Create a mock Octokit with the methods we need
function createMockOctokit(overrides: {
  getRepoPublicKey?: (args: { owner: string; repo: string }) => Promise<{ data: { key_id: string; key: string } }>;
  createOrUpdateRepoSecret?: (args: {
    owner: string;
    repo: string;
    secret_name: string;
    encrypted_value: string;
    key_id: string;
  }) => Promise<void>;
} = {}) {
  return {
    rest: {
      actions: {
        getRepoPublicKey: overrides.getRepoPublicKey ?? vi.fn().mockResolvedValue({
          data: {
            key_id: 'test-key-id',
            key: TEST_PUBLIC_KEY,
          },
        }),
        createOrUpdateRepoSecret: overrides.createOrUpdateRepoSecret ?? vi.fn().mockResolvedValue(undefined),
      },
    },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('GitHubSecretsProvisioner', () => {
  let provisioner: GitHubSecretsProvisioner;

  beforeEach(() => {
    provisioner = new GitHubSecretsProvisioner();
  });

  describe('getRepoPublicKey', () => {
    it('fetches the public key from GitHub', async () => {
      const mockOctokit = createMockOctokit();

      const result = await provisioner.getRepoPublicKey(mockOctokit, 'owner', 'repo');

      expect(result.key_id).toBe('test-key-id');
      expect(result.key).toBe('ug/7DBrOP4EIKNbrqwfx5OtBw1eSrkQOrAQVtOTh8kc=');
      expect(mockOctokit.rest.actions.getRepoPublicKey).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
      });
    });
  });

  describe('encryptSecret', () => {
    it('encrypts a secret value and returns a base64 string', async () => {
      // Use a real 32-byte key (all zeros for testing)
      const publicKeyBase64 = 'ug/7DBrOP4EIKNbrqwfx5OtBw1eSrkQOrAQVtOTh8kc=';

      const encrypted = await provisioner.encryptSecret(publicKeyBase64, 'my-secret-value');

      expect(typeof encrypted).toBe('string');
      expect(encrypted.length).toBeGreaterThan(0);
    });

    it('produces different ciphertexts for the same plaintext (nonce is random)', async () => {
      const publicKeyBase64 = 'ug/7DBrOP4EIKNbrqwfx5OtBw1eSrkQOrAQVtOTh8kc=';

      const encrypted1 = await provisioner.encryptSecret(publicKeyBase64, 'same-value');
      const encrypted2 = await provisioner.encryptSecret(publicKeyBase64, 'same-value');

      // Sealed boxes use random nonces, so ciphertexts should differ
      expect(encrypted1).not.toBe(encrypted2);
    });
  });

  describe('writeSecret', () => {
    it('fetches key, encrypts, and writes secret', async () => {
      const mockOctokit = createMockOctokit();

      await provisioner.writeSecret(mockOctokit, 'owner', 'repo', 'MY_SECRET', 'secret-value');

      expect(mockOctokit.rest.actions.getRepoPublicKey).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
      });
      expect(mockOctokit.rest.actions.createOrUpdateRepoSecret).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: 'owner',
          repo: 'repo',
          secret_name: 'MY_SECRET',
          key_id: 'test-key-id',
          encrypted_value: expect.any(String),
        }),
      );
    });
  });

  describe('provisionApiKey', () => {
    it('provisions API key to multiple repos', async () => {
      const mockOctokit = createMockOctokit();
      const repos = [
        { owner: 'org', name: 'repo1' },
        { owner: 'org', name: 'repo2' },
        { owner: 'org', name: 'repo3' },
      ];

      const results = await provisioner.provisionApiKey(mockOctokit, repos, 'tamma_sk_test-key');

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.success)).toBe(true);
    });

    it('handles per-repo errors without failing the batch', async () => {
      const callCount = { value: 0 };
      const mockOctokit = createMockOctokit({
        getRepoPublicKey: vi.fn().mockImplementation(async ({ repo }: { owner: string; repo: string }) => {
          callCount.value++;
          if (repo === 'repo2') {
            throw new Error('Repository is archived');
          }
          return { data: { key_id: 'test-key-id', key: 'ug/7DBrOP4EIKNbrqwfx5OtBw1eSrkQOrAQVtOTh8kc=' } };
        }),
      });

      const repos = [
        { owner: 'org', name: 'repo1' },
        { owner: 'org', name: 'repo2' },
        { owner: 'org', name: 'repo3' },
      ];

      const results = await provisioner.provisionApiKey(mockOctokit, repos, 'tamma_sk_test-key');

      expect(results).toHaveLength(3);
      const success = results.filter((r) => r.success);
      const failures = results.filter((r) => !r.success);
      expect(success).toHaveLength(2);
      expect(failures).toHaveLength(1);
      expect(failures[0]?.error).toContain('archived');
    });

    it('respects concurrency limit', async () => {
      let maxConcurrent = 0;
      let currentConcurrent = 0;

      const mockOctokit = createMockOctokit({
        getRepoPublicKey: vi.fn().mockImplementation(async () => {
          currentConcurrent++;
          maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
          await new Promise((resolve) => setTimeout(resolve, 10));
          currentConcurrent--;
          return { data: { key_id: 'test-key-id', key: 'ug/7DBrOP4EIKNbrqwfx5OtBw1eSrkQOrAQVtOTh8kc=' } };
        }),
      });

      // Create 10 repos — should be processed in batches of 5
      const repos = Array.from({ length: 10 }, (_, i) => ({
        owner: 'org',
        name: `repo${i}`,
      }));

      const results = await provisioner.provisionApiKey(mockOctokit, repos, 'tamma_sk_test-key');

      expect(results).toHaveLength(10);
      expect(maxConcurrent).toBeLessThanOrEqual(5);
    });

    it('returns empty results for empty repo list', async () => {
      const mockOctokit = createMockOctokit();

      const results = await provisioner.provisionApiKey(mockOctokit, [], 'tamma_sk_test-key');

      expect(results).toHaveLength(0);
    });
  });
});

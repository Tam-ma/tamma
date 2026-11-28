import { readFileSync } from 'node:fs';
import type { GitHubRepoConfig } from '@tamma/shared';
import type { GitPlatformConfig } from '../types/index.js';

/**
 * Build a platform-level GitPlatformConfig from the app-level GitHubRepoConfig.
 * Reads the private key file for App mode.
 */
export function buildPlatformConfig(gh: GitHubRepoConfig): GitPlatformConfig {
  if (gh.authMode === 'app') {
    const privateKey = readFileSync(gh.privateKeyPath, 'utf-8');
    return {
      type: 'app',
      appId: gh.appId,
      privateKey,
      installationId: gh.installationId,
    };
  }
  return {
    type: 'pat',
    token: gh.token,
  };
}

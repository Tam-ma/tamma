import { GitHubPlatform } from './github-platform.js';
import type { GitPlatformAppConfig } from '../types/config.js';

/** Credentials needed to create an App-authenticated platform. */
export interface AppCredentials {
  appId: number;
  privateKey: string;
  baseUrl?: string;
}

/**
 * Create a GitHubPlatform pre-authenticated for a specific installation.
 * The returned platform uses `@octokit/auth-app` which auto-refreshes
 * installation tokens (they expire every 60 minutes).
 */
export async function createGitHubPlatformForInstallation(
  credentials: AppCredentials,
  installationId: number,
): Promise<GitHubPlatform> {
  const platform = new GitHubPlatform();
  const config: GitPlatformAppConfig = {
    type: 'app',
    appId: credentials.appId,
    privateKey: credentials.privateKey,
    installationId,
    ...(credentials.baseUrl !== undefined ? { baseUrl: credentials.baseUrl } : {}),
  };
  await platform.initialize(config);
  return platform;
}

/** PAT-based authentication (personal access token or fine-grained token). */
export interface GitPlatformPATConfig {
  type: 'pat';
  token: string;
  baseUrl?: string;
}

/** GitHub App installation authentication (auto-refreshing tokens). */
export interface GitPlatformAppConfig {
  type: 'app';
  appId: number;
  privateKey: string;
  installationId: number;
  baseUrl?: string;
}

/**
 * Discriminated union for Git platform authentication.
 * Use `config.type` to narrow to the correct variant.
 */
export type GitPlatformConfig = GitPlatformPATConfig | GitPlatformAppConfig;

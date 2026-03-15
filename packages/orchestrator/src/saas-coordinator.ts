/**
 * SaaS Coordinator
 *
 * Manages multiple TammaEngine instances for GitHub App installations.
 * Polls the installation store for active repos and spawns/prunes engines.
 *
 * Each engine operates on a single repo and receives an App-authenticated
 * GitHubPlatform. The coordinator does NOT change the engine interface — it
 * constructs TammaConfig objects with the correct owner/repo/auth per repo.
 */

import type { ILogger } from '@tamma/shared/contracts';
import type { TammaConfig, GitHubAppConfig } from '@tamma/shared';
import type { IGitPlatform } from '@tamma/platforms';
import { createGitHubPlatformForInstallation } from '@tamma/platforms';
import type { AppCredentials } from '@tamma/platforms';
import { TammaEngine } from './engine.js';
import type { EngineContext } from './engine.js';

/** Minimal installation store interface the coordinator needs. */
export interface ICoordinatorInstallationStore {
  listAllActiveRepos(): Promise<Array<{
    installationId: number;
    owner: string;
    name: string;
    fullName: string;
  }>>;
}

export interface SaaSCoordinatorOptions {
  /** Base config template. owner/repo/auth are overridden per repo. */
  baseConfig: TammaConfig;
  /** App credentials for creating per-installation platforms. */
  appCredentials: AppCredentials;
  /** Installation store for discovering repos. */
  installationStore: ICoordinatorInstallationStore;
  /** Logger instance. */
  logger: ILogger;
  /** Factory for creating engine dependencies (agent resolver, etc.). */
  createEngineContext: (config: TammaConfig, platform: IGitPlatform) => Omit<EngineContext, 'config' | 'platform'>;
  /** How often to poll for new/removed installations (default: 60s). */
  pollIntervalMs?: number;
}

/** Tracks a running engine instance for a specific repo. */
interface ManagedEngine {
  engine: TammaEngine;
  platform: IGitPlatform;
  fullName: string;
  installationId: number;
}

export class SaaSCoordinator {
  private engines = new Map<string, ManagedEngine>();
  private running = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: SaaSCoordinatorOptions) {}

  /** Start the coordinator loop. */
  async start(): Promise<void> {
    this.running = true;
    this.options.logger.info('SaaS coordinator starting');
    await this.reconcile();
    this.schedulePoll();
  }

  /** Stop the coordinator and dispose all engines. */
  async stop(): Promise<void> {
    this.running = false;
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    this.options.logger.info(`Stopping ${this.engines.size} engine(s)`);
    const disposePromises: Promise<void>[] = [];
    for (const [key, managed] of this.engines) {
      disposePromises.push(
        managed.engine.dispose()
          .then(() => managed.platform.dispose())
          .catch((err) => {
            this.options.logger.error(`Failed to dispose engine for ${key}`, { error: err });
          }),
      );
    }
    await Promise.all(disposePromises);
    this.engines.clear();
  }

  /** Get the count of currently running engines. */
  get engineCount(): number {
    return this.engines.size;
  }

  /** Get the repo keys of all running engines. */
  get activeRepos(): string[] {
    return [...this.engines.keys()];
  }

  /**
   * Reconcile running engines with the current set of active repos.
   * - Spawn engines for new repos
   * - Prune engines for removed/suspended repos
   */
  private async reconcile(): Promise<void> {
    try {
      const activeRepos = await this.options.installationStore.listAllActiveRepos();
      const activeKeys = new Set(activeRepos.map((r) => r.fullName));

      // Prune engines for repos no longer active
      for (const [key, managed] of this.engines) {
        if (!activeKeys.has(key)) {
          this.options.logger.info(`Pruning engine for ${key}`);
          try {
            await managed.engine.dispose();
            await managed.platform.dispose();
          } catch (err) {
            this.options.logger.error(`Failed to prune engine for ${key}`, { error: err });
          }
          this.engines.delete(key);
        }
      }

      // Spawn engines for new repos
      for (const repo of activeRepos) {
        if (this.engines.has(repo.fullName)) continue;

        try {
          await this.spawnEngine(repo);
        } catch (err) {
          this.options.logger.error(`Failed to spawn engine for ${repo.fullName}`, { error: err });
        }
      }
    } catch (err) {
      this.options.logger.error('Reconciliation failed', { error: err });
    }
  }

  private async spawnEngine(repo: {
    installationId: number;
    owner: string;
    name: string;
    fullName: string;
  }): Promise<void> {
    this.options.logger.info(`Spawning engine for ${repo.fullName}`);

    // Create a per-repo config with App auth
    const repoGitHubConfig: GitHubAppConfig = {
      authMode: 'app',
      appId: this.options.appCredentials.appId,
      privateKeyPath: '', // Not used — platform is created with raw key
      installationId: repo.installationId,
      owner: repo.owner,
      repo: repo.name,
      issueLabels: this.options.baseConfig.github.issueLabels,
      excludeLabels: this.options.baseConfig.github.excludeLabels,
      botUsername: this.options.baseConfig.github.botUsername,
    };

    const repoConfig: TammaConfig = {
      ...this.options.baseConfig,
      github: repoGitHubConfig,
    };

    // Create platform with auto-refreshing App auth
    const platform = await createGitHubPlatformForInstallation(
      this.options.appCredentials,
      repo.installationId,
    );

    // Create engine context
    const deps = this.options.createEngineContext(repoConfig, platform);
    const engine = new TammaEngine({
      config: repoConfig,
      platform,
      ...deps,
    });

    await engine.initialize();

    this.engines.set(repo.fullName, {
      engine,
      platform,
      fullName: repo.fullName,
      installationId: repo.installationId,
    });

    // Start the engine's run loop in the background
    void engine.run().catch((err) => {
      this.options.logger.error(`Engine for ${repo.fullName} crashed`, { error: err });
      this.engines.delete(repo.fullName);
    });
  }

  private schedulePoll(): void {
    if (!this.running) return;
    const interval = this.options.pollIntervalMs ?? 60_000;
    this.pollTimer = setTimeout(() => {
      void this.reconcile().then(() => this.schedulePoll());
    }, interval);
    this.pollTimer.unref();
  }
}

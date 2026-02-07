/**
 * Index Triggers Module
 *
 * Provides automatic triggers for re-indexing:
 * - File system watcher for development mode
 * - Git hooks for post-commit/post-merge
 * - Scheduled re-indexing at configurable intervals
 *
 * @module @tamma/intelligence/indexer/triggers
 */

export {
  FileWatcher,
  createFileWatcher,
  type FileWatcherConfig,
  type FileChangeCallback,
} from './file-watcher.js';

export {
  GitHookInstaller,
  createGitHookInstaller,
  type GitHookConfig,
  type GitHookResult,
} from './git-hook-installer.js';

export {
  Scheduler,
  createScheduler,
  parseInterval,
  type SchedulerConfig,
  type SchedulerCallback,
} from './scheduler.js';

/**
 * File Discovery Module
 *
 * Provides file discovery and gitignore parsing for the codebase indexer.
 *
 * @module @tamma/intelligence/indexer/discovery
 */

export {
  FileDiscovery,
  createFileDiscovery,
  DEFAULT_INCLUDE_PATTERNS,
  DEFAULT_EXCLUDE_PATTERNS,
  type FileDiscoveryOptions,
} from './file-discovery.js';

export {
  GitignoreParser,
  createGitignoreParser,
} from './gitignore-parser.js';

export {
  GitDiffDetector,
  createGitDiffDetector,
  type ChangeType,
  type DetectedChange,
  type GitDiffOptions,
} from './git-diff-detector.js';

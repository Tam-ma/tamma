/**
 * Pattern matchers for permission checking
 * @module @tamma/gates/permissions/matchers
 */

export {
  GlobMatcher,
  createFileGlobMatcher,
  matchesAnyPattern,
  findMatchingPatterns,
  type GlobMatchResult,
} from './glob-matcher.js';

export {
  CommandMatcher,
  createCommandMatcher,
  type CommandMatchResult,
} from './command-matcher.js';

export {
  ToolMatcher,
  createToolMatcher,
  isValidToolName,
  normalizeToolName,
  type ToolMatchResult,
} from './tool-matcher.js';

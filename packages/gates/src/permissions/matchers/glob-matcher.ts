/**
 * Glob pattern matching for file paths
 * @module @tamma/gates/permissions/matchers/glob-matcher
 */

import { minimatch } from 'minimatch';

export interface GlobMatchResult {
  matches: boolean;
  matchedPattern?: string;
}

/**
 * Matcher for file path glob patterns
 */
export class GlobMatcher {
  private readonly allowedPatterns: string[];
  private readonly deniedPatterns: string[];

  constructor(allowedPatterns: string[] = [], deniedPatterns: string[] = []) {
    this.allowedPatterns = allowedPatterns;
    this.deniedPatterns = deniedPatterns;
  }

  /**
   * Check if a path matches any of the patterns
   */
  matchAny(path: string, patterns: string[]): GlobMatchResult {
    const normalizedPath = this.normalizePath(path);

    for (const pattern of patterns) {
      if (this.matchPattern(normalizedPath, pattern)) {
        return { matches: true, matchedPattern: pattern };
      }
    }

    return { matches: false };
  }

  /**
   * Check if a path matches a specific pattern
   */
  matchPattern(path: string, pattern: string): boolean {
    const normalizedPath = this.normalizePath(path);
    const normalizedPattern = this.normalizePattern(pattern);

    return minimatch(normalizedPath, normalizedPattern, {
      dot: true,
      matchBase: true,
      nocase: process.platform === 'win32',
    });
  }

  /**
   * Check if a path is allowed (matches allowed patterns and doesn't match denied)
   * Denied patterns take precedence over allowed patterns
   */
  isAllowed(path: string): GlobMatchResult {
    const normalizedPath = this.normalizePath(path);

    // Check denied patterns first - they take precedence
    const deniedMatch = this.matchAny(normalizedPath, this.deniedPatterns);
    if (deniedMatch.matches) {
      return { matches: false, matchedPattern: deniedMatch.matchedPattern };
    }

    // Check if path matches any allowed pattern
    const allowedMatch = this.matchAny(normalizedPath, this.allowedPatterns);
    if (allowedMatch.matches) {
      return { matches: true, matchedPattern: allowedMatch.matchedPattern };
    }

    // Not in allowed patterns
    return { matches: false };
  }

  /**
   * Check if a path is denied
   */
  isDenied(path: string): GlobMatchResult {
    return this.matchAny(this.normalizePath(path), this.deniedPatterns);
  }

  /**
   * Normalize path for consistent matching
   */
  private normalizePath(path: string): string {
    // Remove leading ./ or /
    let normalized = path.replace(/^\.\//, '').replace(/^\//, '');

    // Normalize path separators on Windows
    if (process.platform === 'win32') {
      normalized = normalized.replace(/\\/g, '/');
    }

    return normalized;
  }

  /**
   * Normalize pattern for consistent matching
   */
  private normalizePattern(pattern: string): string {
    // Normalize path separators on Windows
    if (process.platform === 'win32') {
      return pattern.replace(/\\/g, '/');
    }
    return pattern;
  }

  /**
   * Create a new GlobMatcher with additional patterns
   */
  extend(
    additionalAllowed: string[] = [],
    additionalDenied: string[] = [],
  ): GlobMatcher {
    return new GlobMatcher(
      [...this.allowedPatterns, ...additionalAllowed],
      [...this.deniedPatterns, ...additionalDenied],
    );
  }

  /**
   * Get all patterns
   */
  getPatterns(): { allowed: string[]; denied: string[] } {
    return {
      allowed: [...this.allowedPatterns],
      denied: [...this.deniedPatterns],
    };
  }
}

/**
 * Create a GlobMatcher from file permissions
 */
export function createFileGlobMatcher(
  allowed: string[],
  denied: string[],
): GlobMatcher {
  return new GlobMatcher(allowed, denied);
}

/**
 * Check if a path matches any glob pattern in a list
 */
export function matchesAnyPattern(path: string, patterns: string[]): boolean {
  const matcher = new GlobMatcher(patterns, []);
  return matcher.matchAny(path, patterns).matches;
}

/**
 * Find which patterns in a list match a path
 */
export function findMatchingPatterns(path: string, patterns: string[]): string[] {
  const matching: string[] = [];
  const matcher = new GlobMatcher([], []);

  for (const pattern of patterns) {
    if (matcher.matchPattern(path, pattern)) {
      matching.push(pattern);
    }
  }

  return matching;
}

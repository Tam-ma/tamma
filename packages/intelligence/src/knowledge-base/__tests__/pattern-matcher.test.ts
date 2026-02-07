/**
 * Tests for Pattern Matcher
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PatternMatcher } from '../matchers/pattern-matcher.js';
import type { KnowledgeEntry } from '@tamma/shared';
import type { MatchContext } from '../types.js';

describe('PatternMatcher', () => {
  let matcher: PatternMatcher;

  const createTestEntry = (overrides?: Partial<KnowledgeEntry>): KnowledgeEntry => ({
    id: 'test-id',
    type: 'prohibition',
    title: 'Test Entry',
    description: 'Test description',
    scope: 'global',
    keywords: [],
    priority: 'high',
    source: 'manual',
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: 'test',
    enabled: true,
    timesApplied: 0,
    timesHelpful: 0,
    ...overrides,
  });

  beforeEach(() => {
    matcher = new PatternMatcher();
  });

  describe('file path matching', () => {
    it('should match file paths with simple patterns', async () => {
      const entry = createTestEntry({
        patterns: ['src/auth/'],
      });
      const context: MatchContext = {
        taskDescription: 'Update authentication',
        filePaths: ['src/auth/login.ts', 'src/auth/logout.ts'],
      };

      const result = await matcher.match(entry, context);

      expect(result).not.toBeNull();
      expect(result!.matched).toBe(true);
      expect(result!.matchType).toBe('pattern');
    });

    it('should match file paths with regex patterns', async () => {
      const entry = createTestEntry({
        patterns: ['\\.env.*$', 'secrets\\.'],
      });
      const context: MatchContext = {
        taskDescription: 'Update configuration',
        filePaths: ['.env.local', 'config/secrets.json'],
      };

      const result = await matcher.match(entry, context);

      expect(result).not.toBeNull();
    });

    it('should not match when no file paths match pattern', async () => {
      const entry = createTestEntry({
        patterns: ['legacy/'],
      });
      const context: MatchContext = {
        taskDescription: 'Update service',
        filePaths: ['src/services/user-service.ts'],
      };

      const result = await matcher.match(entry, context);

      expect(result).toBeNull();
    });

    it('should handle multiple patterns', async () => {
      const entry = createTestEntry({
        patterns: ['deprecated/', 'legacy/', 'old/'],
      });
      const context: MatchContext = {
        taskDescription: 'Refactor code',
        filePaths: ['src/legacy/module.ts'],
      };

      const result = await matcher.match(entry, context);

      expect(result).not.toBeNull();
    });
  });

  describe('description matching', () => {
    it('should match patterns in task description', async () => {
      const entry = createTestEntry({
        patterns: ['\\bforce\\s+push\\b', 'delete\\s+main'],
      });
      const context: MatchContext = {
        taskDescription: 'Force push the changes to main branch',
      };

      const result = await matcher.match(entry, context);

      expect(result).not.toBeNull();
    });

    it('should be case insensitive by default', async () => {
      const entry = createTestEntry({
        patterns: ['IMPORTANT'],
      });
      const context: MatchContext = {
        taskDescription: 'This is important data',
      };

      const result = await matcher.match(entry, context);

      expect(result).not.toBeNull();
    });
  });

  describe('plan approach matching', () => {
    it('should match patterns in plan approach', async () => {
      const entry = createTestEntry({
        patterns: ['direct\\s+database\\s+access'],
      });
      const context: MatchContext = {
        taskDescription: 'Get user data',
        planApproach: 'Use direct database access to query users',
      };

      const result = await matcher.match(entry, context);

      expect(result).not.toBeNull();
      expect(result!.reason).toContain('Approach');
    });
  });

  describe('no patterns', () => {
    it('should return null when entry has no patterns', async () => {
      const entry = createTestEntry({
        patterns: undefined,
      });
      const context: MatchContext = {
        taskDescription: 'Any task',
        filePaths: ['src/any/file.ts'],
      };

      const result = await matcher.match(entry, context);

      expect(result).toBeNull();
    });

    it('should return null when entry has empty patterns array', async () => {
      const entry = createTestEntry({
        patterns: [],
      });
      const context: MatchContext = {
        taskDescription: 'Any task',
      };

      const result = await matcher.match(entry, context);

      expect(result).toBeNull();
    });
  });

  describe('invalid patterns', () => {
    it('should skip invalid regex patterns', async () => {
      const entry = createTestEntry({
        patterns: ['[invalid(regex', 'valid-pattern'],
      });
      const context: MatchContext = {
        taskDescription: 'This has valid-pattern in it',
      };

      const result = await matcher.match(entry, context);

      expect(result).not.toBeNull();
    });
  });

  describe('scoring', () => {
    it('should give higher score for more pattern matches', async () => {
      const entry = createTestEntry({
        patterns: ['auth/', 'login', 'password'],
      });

      const context1: MatchContext = {
        taskDescription: 'Update auth',
        filePaths: ['src/auth/service.ts'],
      };
      const context2: MatchContext = {
        taskDescription: 'Update login with password validation',
        filePaths: ['src/auth/login.ts'],
      };

      const result1 = await matcher.match(entry, context1);
      const result2 = await matcher.match(entry, context2);

      expect(result1).not.toBeNull();
      expect(result2).not.toBeNull();
      expect(result2!.score).toBeGreaterThan(result1!.score);
    });

    it('should give bonus for file path matches on prohibitions', async () => {
      const prohibition = createTestEntry({
        type: 'prohibition',
        patterns: ['legacy/'],
      });
      const recommendation = createTestEntry({
        type: 'recommendation',
        patterns: ['legacy/'],
      });

      const context: MatchContext = {
        taskDescription: 'Refactor',
        filePaths: ['src/legacy/module.ts'],
      };

      const prohibitionResult = await matcher.match(prohibition, context);
      const recommendationResult = await matcher.match(recommendation, context);

      expect(prohibitionResult).not.toBeNull();
      expect(recommendationResult).not.toBeNull();
      // Prohibition should get file path bonus
      expect(prohibitionResult!.score).toBeGreaterThan(recommendationResult!.score);
    });
  });

  describe('options', () => {
    it('should respect matchDescription option', async () => {
      const matcher = new PatternMatcher({ matchDescription: false });
      const entry = createTestEntry({
        patterns: ['important'],
      });
      const context: MatchContext = {
        taskDescription: 'This is important',
      };

      const result = await matcher.match(entry, context);

      expect(result).toBeNull();
    });

    it('should respect matchFilePaths option', async () => {
      const matcher = new PatternMatcher({ matchFilePaths: false });
      const entry = createTestEntry({
        patterns: ['auth/'],
      });
      const context: MatchContext = {
        taskDescription: 'Update module',
        filePaths: ['src/auth/service.ts'],
      };

      const result = await matcher.match(entry, context);

      expect(result).toBeNull();
    });

    it('should respect caseInsensitive option', async () => {
      const caseSensitiveMatcher = new PatternMatcher({ caseInsensitive: false });
      const entry = createTestEntry({
        patterns: ['IMPORTANT'],
      });
      const context: MatchContext = {
        taskDescription: 'This is important',
      };

      const result = await caseSensitiveMatcher.match(entry, context);

      expect(result).toBeNull();
    });
  });

  describe('match reason', () => {
    it('should include file paths in reason', async () => {
      const entry = createTestEntry({
        patterns: ['auth/'],
      });
      const context: MatchContext = {
        taskDescription: 'Update',
        filePaths: ['src/auth/login.ts'],
      };

      const result = await matcher.match(entry, context);

      expect(result).not.toBeNull();
      expect(result!.reason).toContain('File path');
      expect(result!.reason).toContain('auth/login.ts');
    });

    it('should include pattern in reason for description matches', async () => {
      const entry = createTestEntry({
        patterns: ['force.*push'],
      });
      const context: MatchContext = {
        taskDescription: 'Force push changes',
      };

      const result = await matcher.match(entry, context);

      expect(result).not.toBeNull();
      expect(result!.reason).toContain('Description');
      expect(result!.reason).toContain('force.*push');
    });
  });
});

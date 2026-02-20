/**
 * Tests for Keyword Matcher
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { KeywordMatcher } from '../matchers/keyword-matcher.js';
import type { KnowledgeEntry } from '@tamma/shared';
import type { MatchContext } from '../types.js';

describe('KeywordMatcher', () => {
  let matcher: KeywordMatcher;

  const createTestEntry = (overrides?: Partial<KnowledgeEntry>): KnowledgeEntry => ({
    id: 'test-id',
    type: 'recommendation',
    title: 'Test Entry',
    description: 'Test description',
    scope: 'global',
    keywords: ['typescript', 'testing', 'best-practice'],
    priority: 'medium',
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
    matcher = new KeywordMatcher();
  });

  describe('basic matching', () => {
    it('should match when keywords are present in task description', async () => {
      const entry = createTestEntry({ keywords: ['typescript', 'api'] });
      const context: MatchContext = {
        taskDescription: 'Implement a TypeScript API endpoint',
      };

      const result = await matcher.match(entry, context);

      expect(result).not.toBeNull();
      expect(result!.matched).toBe(true);
      expect(result!.matchType).toBe('keyword');
    });

    it('should not match when no keywords match', async () => {
      const entry = createTestEntry({ keywords: ['python', 'django'] });
      const context: MatchContext = {
        taskDescription: 'Implement a TypeScript API endpoint',
      };

      const result = await matcher.match(entry, context);

      expect(result).toBeNull();
    });

    it('should be case insensitive', async () => {
      const entry = createTestEntry({ keywords: ['TYPESCRIPT', 'API'] });
      const context: MatchContext = {
        taskDescription: 'implement typescript api',
      };

      const result = await matcher.match(entry, context);

      expect(result).not.toBeNull();
    });
  });

  describe('fuzzy matching', () => {
    it('should match with small typos', async () => {
      const matcher = new KeywordMatcher({ maxDistance: 2 });
      const entry = createTestEntry({ keywords: ['typescript'] });
      const context: MatchContext = {
        taskDescription: 'Implement typescrit code', // typo
      };

      const result = await matcher.match(entry, context);

      expect(result).not.toBeNull();
    });

    it('should not match with large typos when distance is 0', async () => {
      const matcher = new KeywordMatcher({ maxDistance: 0 });
      const entry = createTestEntry({ keywords: ['typescript'] });
      const context: MatchContext = {
        taskDescription: 'Implement typescrit code', // typo
      };

      const result = await matcher.match(entry, context);

      expect(result).toBeNull();
    });
  });

  describe('context sources', () => {
    it('should match keywords from plan approach', async () => {
      const entry = createTestEntry({ keywords: ['caching', 'redis'] });
      const context: MatchContext = {
        taskDescription: 'Improve performance',
        planApproach: 'Use Redis for caching',
      };

      const result = await matcher.match(entry, context);

      expect(result).not.toBeNull();
      expect(result!.reason).toContain('redis');
    });

    it('should match keywords from technologies', async () => {
      const entry = createTestEntry({ keywords: ['react', 'component'] });
      const context: MatchContext = {
        taskDescription: 'Build UI',
        technologies: ['react', 'typescript'],
      };

      const result = await matcher.match(entry, context);

      expect(result).not.toBeNull();
    });

    it('should extract keywords from file paths', async () => {
      const entry = createTestEntry({ keywords: ['auth', 'service'] });
      const context: MatchContext = {
        taskDescription: 'Update module',
        filePaths: ['src/auth/auth-service.ts', 'src/auth/types.ts'],
      };

      const result = await matcher.match(entry, context);

      expect(result).not.toBeNull();
    });
  });

  describe('scoring', () => {
    it('should give higher score for more keyword matches', async () => {
      const entry = createTestEntry({
        keywords: ['api', 'typescript', 'testing', 'validation'],
      });

      const context1: MatchContext = {
        taskDescription: 'Write API code',
      };
      const context2: MatchContext = {
        taskDescription: 'Write TypeScript API with testing and validation',
      };

      const result1 = await matcher.match(entry, context1);
      const result2 = await matcher.match(entry, context2);

      expect(result1).not.toBeNull();
      expect(result2).not.toBeNull();
      expect(result2!.score).toBeGreaterThan(result1!.score);
    });

    it('should boost score for exact matches vs fuzzy matches', async () => {
      const matcher = new KeywordMatcher({ maxDistance: 2 });
      const entry = createTestEntry({ keywords: ['typescript'] });

      const exactContext: MatchContext = {
        taskDescription: 'Write typescript code',
      };
      const fuzzyContext: MatchContext = {
        taskDescription: 'Write typescrit code', // typo
      };

      const exactResult = await matcher.match(entry, exactContext);
      const fuzzyResult = await matcher.match(entry, fuzzyContext);

      expect(exactResult).not.toBeNull();
      expect(fuzzyResult).not.toBeNull();
      expect(exactResult!.score).toBeGreaterThan(fuzzyResult!.score);
    });
  });

  describe('options', () => {
    it('should respect minMatches option', async () => {
      const matcher = new KeywordMatcher({ minMatches: 2 });
      const entry = createTestEntry({
        keywords: ['api', 'typescript', 'testing'],
      });

      const context1: MatchContext = {
        taskDescription: 'Build API',
      };
      const context2: MatchContext = {
        taskDescription: 'Build TypeScript API',
      };

      const result1 = await matcher.match(entry, context1);
      const result2 = await matcher.match(entry, context2);

      expect(result1).toBeNull(); // Only 1 match
      expect(result2).not.toBeNull(); // 2 matches
    });

    it('should apply score boost', async () => {
      const normalMatcher = new KeywordMatcher({ scoreBoost: 1.0 });
      const boostedMatcher = new KeywordMatcher({ scoreBoost: 2.0 });

      const entry = createTestEntry({ keywords: ['api'] });
      const context: MatchContext = {
        taskDescription: 'Build API',
      };

      const normalResult = await normalMatcher.match(entry, context);
      const boostedResult = await boostedMatcher.match(entry, context);

      expect(normalResult).not.toBeNull();
      expect(boostedResult).not.toBeNull();
      expect(boostedResult!.score).toBeGreaterThan(normalResult!.score);
    });
  });

  describe('match reason', () => {
    it('should include matched keywords in reason', async () => {
      const entry = createTestEntry({
        keywords: ['api', 'typescript', 'validation'],
      });
      const context: MatchContext = {
        taskDescription: 'Build TypeScript API',
      };

      const result = await matcher.match(entry, context);

      expect(result).not.toBeNull();
      expect(result!.reason).toContain('api');
      expect(result!.reason).toContain('typescript');
    });

    it('should truncate long match lists', async () => {
      const entry = createTestEntry({
        keywords: [
          'one', 'two', 'three', 'four', 'five',
          'six', 'seven', 'eight', 'nine', 'ten',
        ],
      });
      const context: MatchContext = {
        taskDescription: 'one two three four five six seven eight nine ten',
      };

      const result = await matcher.match(entry, context);

      expect(result).not.toBeNull();
      expect(result!.reason).toContain('+');
    });
  });
});

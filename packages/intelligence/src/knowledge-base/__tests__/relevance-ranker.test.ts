/**
 * Tests for Relevance Ranker
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  RelevanceRanker,
  combineMatchResults,
} from '../matchers/relevance-ranker.js';
import type { KnowledgeEntry, KnowledgeQuery } from '@tamma/shared';
import type { MatchResult } from '../types.js';

describe('RelevanceRanker', () => {
  let ranker: RelevanceRanker;

  const createTestEntry = (overrides?: Partial<KnowledgeEntry>): KnowledgeEntry => ({
    id: 'test-id',
    type: 'recommendation',
    title: 'Test Entry',
    description: 'Test description',
    scope: 'global',
    keywords: ['test'],
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

  const createTestQuery = (overrides?: Partial<KnowledgeQuery>): KnowledgeQuery => ({
    taskType: 'implement',
    taskDescription: 'Implement feature',
    projectId: 'my-project',
    agentType: 'implementer',
    ...overrides,
  });

  const createMatchResult = (overrides?: Partial<MatchResult>): MatchResult => ({
    matched: true,
    score: 0.7,
    reason: 'Test match',
    matchType: 'keyword',
    ...overrides,
  });

  beforeEach(() => {
    ranker = new RelevanceRanker();
  });

  describe('rank', () => {
    it('should rank entries by score', async () => {
      const entries = [
        createTestEntry({ id: 'entry-1' }),
        createTestEntry({ id: 'entry-2' }),
        createTestEntry({ id: 'entry-3' }),
      ];

      const matches = new Map<string, MatchResult>([
        ['entry-1', createMatchResult({ score: 0.5 })],
        ['entry-2', createMatchResult({ score: 0.9 })],
        ['entry-3', createMatchResult({ score: 0.7 })],
      ]);

      const query = createTestQuery();
      const ranked = await ranker.rank(entries, query, matches);

      expect(ranked[0]!.entry.id).toBe('entry-2');
      expect(ranked[1]!.entry.id).toBe('entry-3');
      expect(ranked[2]!.entry.id).toBe('entry-1');
    });

    it('should apply priority boost', async () => {
      const entries = [
        createTestEntry({ id: 'entry-low', priority: 'low' }),
        createTestEntry({ id: 'entry-critical', priority: 'critical' }),
      ];

      const matches = new Map<string, MatchResult>([
        ['entry-low', createMatchResult({ score: 0.9 })], // High base score
        ['entry-critical', createMatchResult({ score: 0.7 })], // Lower base score
      ]);

      const query = createTestQuery();
      const ranked = await ranker.rank(entries, query, matches);

      // Critical should rank higher due to priority boost
      expect(ranked[0]!.entry.id).toBe('entry-critical');
    });

    it('should boost project-scoped entries for matching project', async () => {
      const entries = [
        createTestEntry({ id: 'global', scope: 'global' }),
        createTestEntry({
          id: 'project-specific',
          scope: 'project',
          projectId: 'my-project',
        }),
      ];

      const matches = new Map<string, MatchResult>([
        ['global', createMatchResult({ score: 0.8 })],
        ['project-specific', createMatchResult({ score: 0.8 })], // Same score
      ]);

      const query = createTestQuery({ projectId: 'my-project' });
      const ranked = await ranker.rank(entries, query, matches);

      // Project-specific should rank higher for matching project
      expect(ranked[0]!.entry.id).toBe('project-specific');
    });

    it('should penalize project-scoped entries for non-matching project', async () => {
      const entries = [
        createTestEntry({ id: 'global', scope: 'global' }),
        createTestEntry({
          id: 'other-project',
          scope: 'project',
          projectId: 'other-project',
        }),
      ];

      const matches = new Map<string, MatchResult>([
        ['global', createMatchResult({ score: 0.8 })],
        ['other-project', createMatchResult({ score: 0.8 })],
      ]);

      const query = createTestQuery({ projectId: 'my-project' });
      const ranked = await ranker.rank(entries, query, matches);

      // Global should rank higher
      expect(ranked[0]!.entry.id).toBe('global');
    });

    it('should boost agent-type entries for matching agent', async () => {
      const entries = [
        createTestEntry({ id: 'no-agent-type', agentTypes: undefined }),
        createTestEntry({
          id: 'matching-agent',
          scope: 'agent_type',
          agentTypes: ['implementer'],
        }),
      ];

      const matches = new Map<string, MatchResult>([
        ['no-agent-type', createMatchResult({ score: 0.8 })],
        ['matching-agent', createMatchResult({ score: 0.8 })],
      ]);

      const query = createTestQuery({ agentType: 'implementer' });
      const ranked = await ranker.rank(entries, query, matches);

      // Matching agent type should rank higher
      expect(ranked[0]!.entry.id).toBe('matching-agent');
    });

    it('should consider helpfulness ratio', async () => {
      const entries = [
        createTestEntry({ id: 'helpful', timesApplied: 10, timesHelpful: 9 }),
        createTestEntry({ id: 'not-helpful', timesApplied: 10, timesHelpful: 1 }),
      ];

      const matches = new Map<string, MatchResult>([
        ['helpful', createMatchResult({ score: 0.8 })],
        ['not-helpful', createMatchResult({ score: 0.8 })],
      ]);

      const query = createTestQuery();
      const ranked = await ranker.rank(entries, query, matches);

      // Helpful entry should rank higher
      expect(ranked[0]!.entry.id).toBe('helpful');
    });

    it('should apply recency boost', async () => {
      const oldDate = new Date();
      oldDate.setFullYear(oldDate.getFullYear() - 1);

      const entries = [
        createTestEntry({ id: 'old', updatedAt: oldDate }),
        createTestEntry({ id: 'new', updatedAt: new Date() }),
      ];

      const matches = new Map<string, MatchResult>([
        ['old', createMatchResult({ score: 0.8 })],
        ['new', createMatchResult({ score: 0.8 })],
      ]);

      const query = createTestQuery();
      const ranked = await ranker.rank(entries, query, matches);

      // Newer entry should rank higher
      expect(ranked[0]!.entry.id).toBe('new');
    });

    it('should exclude entries without matches', async () => {
      const entries = [
        createTestEntry({ id: 'matched' }),
        createTestEntry({ id: 'unmatched' }),
      ];

      const matches = new Map<string, MatchResult>([
        ['matched', createMatchResult({ score: 0.8 })],
        // 'unmatched' has no match result
      ]);

      const query = createTestQuery();
      const ranked = await ranker.rank(entries, query, matches);

      expect(ranked).toHaveLength(1);
      expect(ranked[0]!.entry.id).toBe('matched');
    });

    it('should handle different match types', async () => {
      const entries = [
        createTestEntry({ id: 'keyword' }),
        createTestEntry({ id: 'pattern' }),
        createTestEntry({ id: 'semantic' }),
      ];

      const matches = new Map<string, MatchResult>([
        ['keyword', createMatchResult({ score: 0.8, matchType: 'keyword' })],
        ['pattern', createMatchResult({ score: 0.8, matchType: 'pattern' })],
        ['semantic', createMatchResult({ score: 0.8, matchType: 'semantic' })],
      ]);

      const query = createTestQuery();
      const ranked = await ranker.rank(entries, query, matches);

      // All should be ranked with different base scores due to match type weights
      expect(ranked).toHaveLength(3);
    });
  });

  describe('combineMatchResults', () => {
    it('should combine multiple match results', () => {
      const results: MatchResult[] = [
        createMatchResult({ score: 0.8, matchType: 'keyword', reason: 'Keyword A' }),
        createMatchResult({ score: 0.9, matchType: 'pattern', reason: 'Pattern B' }),
      ];

      const combined = combineMatchResults(results);

      expect(combined).not.toBeNull();
      expect(combined!.matched).toBe(true);
      expect(combined!.matchType).toBe('combined');
      expect(combined!.reason).toContain('Keyword A');
      expect(combined!.reason).toContain('Pattern B');
    });

    it('should return null for empty results', () => {
      const combined = combineMatchResults([]);
      expect(combined).toBeNull();
    });

    it('should calculate weighted average score', () => {
      const results: MatchResult[] = [
        createMatchResult({ score: 0.6, matchType: 'keyword' }),
        createMatchResult({ score: 0.9, matchType: 'pattern' }),
        createMatchResult({ score: 0.8, matchType: 'semantic' }),
      ];

      const combined = combineMatchResults(results);

      // Score should be weighted average
      expect(combined).not.toBeNull();
      expect(combined!.score).toBeGreaterThan(0);
      expect(combined!.score).toBeLessThan(1);
    });
  });

  describe('options', () => {
    it('should respect custom weights', async () => {
      const ranker1 = new RelevanceRanker({
        keywordWeight: 1.0,
        patternWeight: 0.1,
      });
      const ranker2 = new RelevanceRanker({
        keywordWeight: 0.1,
        patternWeight: 1.0,
      });

      const entries = [
        createTestEntry({ id: 'keyword-entry' }),
        createTestEntry({ id: 'pattern-entry' }),
      ];

      const matches = new Map<string, MatchResult>([
        ['keyword-entry', createMatchResult({ score: 0.8, matchType: 'keyword' })],
        ['pattern-entry', createMatchResult({ score: 0.8, matchType: 'pattern' })],
      ]);

      const query = createTestQuery();

      const ranked1 = await ranker1.rank(entries, query, matches);
      const ranked2 = await ranker2.rank(entries, query, matches);

      // With high keyword weight, keyword entry should rank first
      expect(ranked1[0]!.entry.id).toBe('keyword-entry');
      // With high pattern weight, pattern entry should rank first
      expect(ranked2[0]!.entry.id).toBe('pattern-entry');
    });

    it('should respect priority boosts', async () => {
      const ranker = new RelevanceRanker({
        priorityBoosts: {
          low: 0.5,
          medium: 1.0,
          high: 1.5,
          critical: 3.0, // Very high boost
        },
      });

      const entries = [
        createTestEntry({ id: 'low', priority: 'low' }),
        createTestEntry({ id: 'critical', priority: 'critical' }),
      ];

      const matches = new Map<string, MatchResult>([
        ['low', createMatchResult({ score: 0.9 })],
        ['critical', createMatchResult({ score: 0.5 })], // Much lower score
      ]);

      const query = createTestQuery();
      const ranked = await ranker.rank(entries, query, matches);

      // Critical should still win due to high priority boost
      expect(ranked[0]!.entry.id).toBe('critical');
    });

    it('should respect recency decay', async () => {
      const oldDate = new Date();
      oldDate.setFullYear(oldDate.getFullYear() - 1);

      // High decay = old entries penalized more
      const rankerHighDecay = new RelevanceRanker({ recencyDecay: 1.0 });
      // No decay = old and new equal
      const rankerNoDecay = new RelevanceRanker({ recencyDecay: 0 });

      const entries = [
        createTestEntry({ id: 'old', updatedAt: oldDate }),
        createTestEntry({ id: 'new', updatedAt: new Date() }),
      ];

      const matches = new Map<string, MatchResult>([
        ['old', createMatchResult({ score: 0.8 })],
        ['new', createMatchResult({ score: 0.8 })],
      ]);

      const query = createTestQuery();

      const rankedHighDecay = await rankerHighDecay.rank(entries, query, matches);
      const rankedNoDecay = await rankerNoDecay.rank(entries, query, matches);

      // High decay should strongly prefer new
      expect(rankedHighDecay[0]!.entry.id).toBe('new');

      // No decay should have similar scores (rank by other factors)
      const scoreDiff = Math.abs(
        rankedNoDecay[0]!.score - rankedNoDecay[1]!.score
      );
      expect(scoreDiff).toBeLessThan(0.01);
    });
  });
});

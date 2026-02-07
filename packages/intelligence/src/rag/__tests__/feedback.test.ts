/**
 * Tests for Feedback Tracker
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FeedbackTracker, createFeedbackTracker } from '../feedback.js';
import { FeedbackError } from '../errors.js';

describe('FeedbackTracker', () => {
  let tracker: FeedbackTracker;

  beforeEach(() => {
    tracker = createFeedbackTracker();
  });

  describe('recordFeedback', () => {
    it('should record feedback', async () => {
      await tracker.recordFeedback({
        queryId: 'q1',
        chunkId: 'c1',
        rating: 'helpful',
        timestamp: new Date(),
      });

      const feedback = await tracker.getQueryFeedback('q1');
      expect(feedback).toHaveLength(1);
      expect(feedback[0].rating).toBe('helpful');
    });

    it('should require queryId', async () => {
      await expect(
        tracker.recordFeedback({
          queryId: '',
          chunkId: 'c1',
          rating: 'helpful',
          timestamp: new Date(),
        })
      ).rejects.toThrow(FeedbackError);
    });

    it('should require chunkId', async () => {
      await expect(
        tracker.recordFeedback({
          queryId: 'q1',
          chunkId: '',
          rating: 'helpful',
          timestamp: new Date(),
        })
      ).rejects.toThrow(FeedbackError);
    });

    it('should record multiple feedback for same query', async () => {
      await tracker.recordFeedback({
        queryId: 'q1',
        chunkId: 'c1',
        rating: 'helpful',
        timestamp: new Date(),
      });

      await tracker.recordFeedback({
        queryId: 'q1',
        chunkId: 'c2',
        rating: 'not_helpful',
        timestamp: new Date(),
      });

      const feedback = await tracker.getQueryFeedback('q1');
      expect(feedback).toHaveLength(2);
    });
  });

  describe('getFeedbackStats', () => {
    it('should return stats for query with feedback', async () => {
      await tracker.recordFeedback({
        queryId: 'q1',
        chunkId: 'c1',
        rating: 'helpful',
        timestamp: new Date(),
      });

      await tracker.recordFeedback({
        queryId: 'q1',
        chunkId: 'c2',
        rating: 'not_helpful',
        timestamp: new Date(),
      });

      const stats = await tracker.getFeedbackStats('q1');

      expect(stats.queryId).toBe('q1');
      expect(stats.totalFeedback).toBe(2);
      expect(stats.helpfulCount).toBe(1);
      expect(stats.avgRating).toBe(2); // (3 + 1) / 2
    });

    it('should return empty stats for query without feedback', async () => {
      const stats = await tracker.getFeedbackStats('nonexistent');

      expect(stats.totalFeedback).toBe(0);
      expect(stats.helpfulCount).toBe(0);
      expect(stats.avgRating).toBe(0);
    });
  });

  describe('trackContextUsage', () => {
    it('should track context usage', async () => {
      await tracker.trackContextUsage('q1', ['c1', 'c2', 'c3']);

      const usage = await tracker.getContextUsage('q1');

      expect(usage).not.toBeNull();
      expect(usage?.usedChunkIds).toEqual(['c1', 'c2', 'c3']);
    });

    it('should return null for untracked query', async () => {
      const usage = await tracker.getContextUsage('nonexistent');

      expect(usage).toBeNull();
    });
  });

  describe('getChunkFeedback', () => {
    it('should get feedback for a specific chunk across queries', async () => {
      await tracker.recordFeedback({
        queryId: 'q1',
        chunkId: 'c1',
        rating: 'helpful',
        timestamp: new Date(),
      });

      await tracker.recordFeedback({
        queryId: 'q2',
        chunkId: 'c1',
        rating: 'partially_helpful',
        timestamp: new Date(),
      });

      const feedback = await tracker.getChunkFeedback('c1');

      expect(feedback).toHaveLength(2);
    });
  });

  describe('getChunkStats', () => {
    it('should calculate chunk statistics', async () => {
      await tracker.recordFeedback({
        queryId: 'q1',
        chunkId: 'c1',
        rating: 'helpful',
        timestamp: new Date(),
      });

      await tracker.recordFeedback({
        queryId: 'q2',
        chunkId: 'c1',
        rating: 'helpful',
        timestamp: new Date(),
      });

      const stats = await tracker.getChunkStats('c1');

      expect(stats.totalFeedback).toBe(2);
      expect(stats.helpfulRate).toBe(1);
      expect(stats.avgRating).toBe(3);
    });

    it('should return zero stats for chunk without feedback', async () => {
      const stats = await tracker.getChunkStats('nonexistent');

      expect(stats.totalFeedback).toBe(0);
      expect(stats.helpfulRate).toBe(0);
    });
  });

  describe('getLowRatedChunks', () => {
    it('should identify low-rated chunks', async () => {
      // Add enough feedback for threshold (3)
      for (let i = 0; i < 3; i++) {
        await tracker.recordFeedback({
          queryId: `q${i}`,
          chunkId: 'bad_chunk',
          rating: 'not_helpful',
          timestamp: new Date(),
        });
      }

      const lowRated = await tracker.getLowRatedChunks(1.5);

      expect(lowRated).toContain('bad_chunk');
    });

    it('should not include chunks with too few ratings', async () => {
      await tracker.recordFeedback({
        queryId: 'q1',
        chunkId: 'c1',
        rating: 'not_helpful',
        timestamp: new Date(),
      });

      const lowRated = await tracker.getLowRatedChunks(1.5);

      expect(lowRated).not.toContain('c1');
    });
  });

  describe('getOverallStats', () => {
    it('should calculate overall statistics', async () => {
      await tracker.recordFeedback({
        queryId: 'q1',
        chunkId: 'c1',
        rating: 'helpful',
        timestamp: new Date(),
      });

      await tracker.recordFeedback({
        queryId: 'q2',
        chunkId: 'c2',
        rating: 'not_helpful',
        timestamp: new Date(),
      });

      const stats = tracker.getOverallStats();

      expect(stats.totalQueries).toBe(2);
      expect(stats.totalFeedback).toBe(2);
      expect(stats.avgHelpfulRate).toBe(0.5);
    });
  });

  describe('clear', () => {
    it('should clear all feedback data', async () => {
      await tracker.recordFeedback({
        queryId: 'q1',
        chunkId: 'c1',
        rating: 'helpful',
        timestamp: new Date(),
      });

      await tracker.trackContextUsage('q1', ['c1']);

      tracker.clear();

      expect(await tracker.getQueryFeedback('q1')).toHaveLength(0);
      expect(await tracker.getContextUsage('q1')).toBeNull();
    });
  });

  describe('pruneOldFeedback', () => {
    it('should remove old feedback', async () => {
      const now = Date.now();

      // Add old feedback
      await tracker.recordFeedback({
        queryId: 'old',
        chunkId: 'c1',
        rating: 'helpful',
        timestamp: new Date(now - 100 * 24 * 60 * 60 * 1000), // 100 days ago
      });

      // Add recent feedback
      await tracker.recordFeedback({
        queryId: 'recent',
        chunkId: 'c2',
        rating: 'helpful',
        timestamp: new Date(),
      });

      const pruned = tracker.pruneOldFeedback(30);

      expect(pruned).toBe(1);
      expect(await tracker.getQueryFeedback('old')).toHaveLength(0);
      expect(await tracker.getQueryFeedback('recent')).toHaveLength(1);
    });
  });
});

describe('createFeedbackTracker', () => {
  it('should create a feedback tracker instance', () => {
    const tracker = createFeedbackTracker();

    expect(tracker).toBeInstanceOf(FeedbackTracker);
  });
});

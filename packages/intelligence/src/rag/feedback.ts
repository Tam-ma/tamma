/**
 * Feedback Tracker
 *
 * Tracks relevance feedback for RAG queries to enable
 * continuous improvement of retrieval quality.
 */

import type {
  RelevanceFeedback,
  FeedbackStats,
  RelevanceRating,
} from './types.js';
import { FeedbackError } from './errors.js';

/**
 * Internal feedback storage entry
 */
interface FeedbackEntry extends RelevanceFeedback {
  id: string;
}

/**
 * Context usage tracking
 */
interface ContextUsage {
  queryId: string;
  usedChunkIds: string[];
  timestamp: Date;
}

/**
 * Feedback tracker for RAG queries
 */
export class FeedbackTracker {
  private feedback: Map<string, FeedbackEntry[]>;
  private contextUsage: Map<string, ContextUsage>;
  private nextId: number;

  constructor() {
    this.feedback = new Map();
    this.contextUsage = new Map();
    this.nextId = 1;
  }

  /**
   * Record relevance feedback for a query
   */
  async recordFeedback(feedback: RelevanceFeedback): Promise<void> {
    const { queryId, chunkId, rating, comment } = feedback;

    if (!queryId || !chunkId) {
      throw new FeedbackError('queryId and chunkId are required');
    }

    const entry: FeedbackEntry = {
      id: `fb-${this.nextId++}`,
      queryId,
      chunkId,
      rating,
      comment,
      timestamp: feedback.timestamp ?? new Date(),
    };

    const existing = this.feedback.get(queryId) ?? [];
    existing.push(entry);
    this.feedback.set(queryId, existing);
  }

  /**
   * Get all feedback for a query
   */
  async getQueryFeedback(queryId: string): Promise<RelevanceFeedback[]> {
    return this.feedback.get(queryId) ?? [];
  }

  /**
   * Get feedback statistics for a query
   */
  async getFeedbackStats(queryId: string): Promise<FeedbackStats> {
    const entries = this.feedback.get(queryId) ?? [];

    if (entries.length === 0) {
      return {
        queryId,
        totalFeedback: 0,
        helpfulCount: 0,
        avgRating: 0,
      };
    }

    let helpfulCount = 0;
    let totalRating = 0;

    for (const entry of entries) {
      const rating = this.ratingToNumber(entry.rating);
      totalRating += rating;
      if (entry.rating === 'helpful') {
        helpfulCount++;
      }
    }

    return {
      queryId,
      totalFeedback: entries.length,
      helpfulCount,
      avgRating: totalRating / entries.length,
    };
  }

  /**
   * Track which chunks were actually used in the response
   */
  async trackContextUsage(queryId: string, usedChunkIds: string[]): Promise<void> {
    this.contextUsage.set(queryId, {
      queryId,
      usedChunkIds,
      timestamp: new Date(),
    });
  }

  /**
   * Get context usage for a query
   */
  async getContextUsage(queryId: string): Promise<ContextUsage | null> {
    return this.contextUsage.get(queryId) ?? null;
  }

  /**
   * Get all feedback for a specific chunk across queries
   */
  async getChunkFeedback(chunkId: string): Promise<RelevanceFeedback[]> {
    const result: RelevanceFeedback[] = [];

    for (const entries of this.feedback.values()) {
      for (const entry of entries) {
        if (entry.chunkId === chunkId) {
          result.push(entry);
        }
      }
    }

    return result;
  }

  /**
   * Calculate aggregate statistics for a chunk
   */
  async getChunkStats(chunkId: string): Promise<{
    totalFeedback: number;
    helpfulRate: number;
    avgRating: number;
  }> {
    const feedback = await this.getChunkFeedback(chunkId);

    if (feedback.length === 0) {
      return {
        totalFeedback: 0,
        helpfulRate: 0,
        avgRating: 0,
      };
    }

    let helpfulCount = 0;
    let totalRating = 0;

    for (const entry of feedback) {
      totalRating += this.ratingToNumber(entry.rating);
      if (entry.rating === 'helpful') {
        helpfulCount++;
      }
    }

    return {
      totalFeedback: feedback.length,
      helpfulRate: helpfulCount / feedback.length,
      avgRating: totalRating / feedback.length,
    };
  }

  /**
   * Get chunks with low ratings that might need improvement
   */
  async getLowRatedChunks(threshold = 1.5): Promise<string[]> {
    const chunkIds = new Set<string>();

    for (const entries of this.feedback.values()) {
      for (const entry of entries) {
        chunkIds.add(entry.chunkId);
      }
    }

    const lowRated: string[] = [];

    for (const chunkId of chunkIds) {
      const stats = await this.getChunkStats(chunkId);
      if (stats.totalFeedback >= 3 && stats.avgRating < threshold) {
        lowRated.push(chunkId);
      }
    }

    return lowRated;
  }

  /**
   * Get overall feedback statistics
   */
  getOverallStats(): {
    totalQueries: number;
    totalFeedback: number;
    avgHelpfulRate: number;
  } {
    let totalFeedback = 0;
    let helpfulCount = 0;

    for (const entries of this.feedback.values()) {
      for (const entry of entries) {
        totalFeedback++;
        if (entry.rating === 'helpful') {
          helpfulCount++;
        }
      }
    }

    return {
      totalQueries: this.feedback.size,
      totalFeedback,
      avgHelpfulRate: totalFeedback > 0 ? helpfulCount / totalFeedback : 0,
    };
  }

  /**
   * Clear all feedback data
   */
  clear(): void {
    this.feedback.clear();
    this.contextUsage.clear();
  }

  /**
   * Clear feedback older than specified days
   */
  pruneOldFeedback(maxAgeDays: number): number {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    let pruned = 0;

    for (const [queryId, entries] of this.feedback) {
      const filtered = entries.filter((e) => e.timestamp.getTime() > cutoff);
      if (filtered.length !== entries.length) {
        pruned += entries.length - filtered.length;
        if (filtered.length === 0) {
          this.feedback.delete(queryId);
        } else {
          this.feedback.set(queryId, filtered);
        }
      }
    }

    // Also prune context usage
    for (const [queryId, usage] of this.contextUsage) {
      if (usage.timestamp.getTime() <= cutoff) {
        this.contextUsage.delete(queryId);
      }
    }

    return pruned;
  }

  /**
   * Convert rating to numeric value
   */
  private ratingToNumber(rating: RelevanceRating): number {
    switch (rating) {
      case 'helpful':
        return 3;
      case 'partially_helpful':
        return 2;
      case 'not_helpful':
        return 1;
      default:
        return 0;
    }
  }
}

/**
 * Create a feedback tracker instance
 */
export function createFeedbackTracker(): FeedbackTracker {
  return new FeedbackTracker();
}

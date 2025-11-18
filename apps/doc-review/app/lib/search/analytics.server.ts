import { generateId } from '../utils/id';
import type { Database } from '../db/client.server';

/**
 * Search Analytics Service
 * Tracks and analyzes search behavior for improving search quality
 */

interface SearchMetrics {
  totalSearches: number;
  uniqueUsers: number;
  avgResultCount: number;
  avgResponseTime: number;
  clickThroughRate: number;
  noResultsRate: number;
  topQueries: Array<{ query: string; count: number }>;
  topNoResultsQueries: Array<{ query: string; count: number }>;
  searchesByType: Record<string, number>;
  searchesByHour: Array<{ hour: number; count: number }>;
}

export class SearchAnalytics {
  constructor(private db: Database) {}

  /**
   * Log a search query
   */
  async logSearch(params: {
    userId?: string | null;
    sessionId?: string | null;
    query: string;
    queryType?: 'full_text' | 'autocomplete' | 'filter';
    filters?: Record<string, any>;
    resultCount: number;
    responseTimeMs: number;
  }): Promise<string> {
    const id = generateId();
    const now = Date.now();

    await this.db.$client
      .prepare(`INSERT INTO search_queries (
        id, user_id, session_id, query, query_type, filters,
        result_count, response_time_ms, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        id,
        params.userId || null,
        params.sessionId || null,
        params.query,
        params.queryType || 'full_text',
        params.filters ? JSON.stringify(params.filters) : null,
        params.resultCount,
        params.responseTimeMs,
        now
      )
      .run();

    // Update popular searches
    await this.updatePopularSearches(params.query, params.resultCount);

    return id;
  }

  /**
   * Log a search result click
   */
  async logSearchClick(params: {
    searchId: string;
    resultId: string;
    resultType: string;
    resultRank: number;
  }): Promise<void> {
    await this.db.$client
      .prepare(`UPDATE search_queries
       SET clicked_result_id = ?,
           clicked_result_type = ?,
           clicked_result_rank = ?
       WHERE id = ?`)
      .bind(
        params.resultId,
        params.resultType,
        params.resultRank,
        params.searchId
      )
      .run();
  }

  /**
   * Update popular searches table
   */
  private async updatePopularSearches(query: string, resultCount: number): Promise<void> {
    const now = Date.now();

    const existingResult = await this.db.$client
      .prepare(`SELECT id, search_count, avg_result_count
       FROM search_popular
       WHERE query = ?`)
      .bind(query)
      .first();
    const existing = existingResult as {
      id: string;
      search_count: number;
      avg_result_count: number;
    } | null;

    if (existing) {
      // Update existing popular search
      const newCount = existing.search_count + 1;
      const newAvg =
        (existing.avg_result_count * existing.search_count + resultCount) / newCount;

      await this.db.$client
        .prepare(`UPDATE search_popular
         SET search_count = ?,
             avg_result_count = ?,
             last_searched_at = ?,
             updated_at = ?
         WHERE id = ?`)
        .bind(newCount, newAvg, now, now, existing.id)
        .run();
    } else {
      // Insert new popular search
      await this.db.$client
        .prepare(`INSERT INTO search_popular (
          id, query, search_count, last_searched_at,
          avg_result_count, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(generateId(), query, 1, now, resultCount, now)
        .run();
    }
  }

  /**
   * Get search metrics for a time period
   */
  async getMetrics(params: {
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  }): Promise<SearchMetrics> {
    const startTime = params.startDate?.getTime() || Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days ago
    const endTime = params.endDate?.getTime() || Date.now();
    const limit = params.limit || 10;

    // Total searches
    const totalSearchesResult = await this.db.$client
      .prepare(`SELECT COUNT(*) as count
       FROM search_queries
       WHERE created_at BETWEEN ? AND ?`)
      .bind(startTime, endTime)
      .first<{ count: number }>();

    // Unique users
    const uniqueUsersResult = await this.db.$client
      .prepare(`SELECT COUNT(DISTINCT user_id) as count
       FROM search_queries
       WHERE user_id IS NOT NULL
         AND created_at BETWEEN ? AND ?`)
      .bind(startTime, endTime)
      .first<{ count: number }>();

    // Average result count
    const avgResultCountResult = await this.db.$client
      .prepare(`SELECT AVG(result_count) as avg
       FROM search_queries
       WHERE created_at BETWEEN ? AND ?`)
      .bind(startTime, endTime)
      .first<{ avg: number }>();

    // Average response time
    const avgResponseTimeResult = await this.db.$client
      .prepare(`SELECT AVG(response_time_ms) as avg
       FROM search_queries
       WHERE created_at BETWEEN ? AND ?`)
      .bind(startTime, endTime)
      .first<{ avg: number }>();

    // Click-through rate
    const clickThroughResult = await this.db.$client
      .prepare(`SELECT
         COUNT(CASE WHEN clicked_result_id IS NOT NULL THEN 1 END) as clicked,
         COUNT(*) as total
       FROM search_queries
       WHERE created_at BETWEEN ? AND ?`)
      .bind(startTime, endTime)
      .first<{ clicked: number; total: number }>();

    // No results rate
    const noResultsResult = await this.db.$client
      .prepare(`SELECT
         COUNT(CASE WHEN result_count = 0 THEN 1 END) as no_results,
         COUNT(*) as total
       FROM search_queries
       WHERE created_at BETWEEN ? AND ?`)
      .bind(startTime, endTime)
      .first<{ no_results: number; total: number }>();

    // Top queries
    const topQueriesResult = await this.db.$client
      .prepare(`SELECT query, COUNT(*) as count
       FROM search_queries
       WHERE created_at BETWEEN ? AND ?
       GROUP BY query
       ORDER BY count DESC
       LIMIT ?`)
      .bind(startTime, endTime, limit)
      .all<{ query: string; count: number }>();
    const topQueries = topQueriesResult.results || [];

    // Top no-results queries
    const topNoResultsQueriesResult = await this.db.$client
      .prepare(`SELECT query, COUNT(*) as count
       FROM search_queries
       WHERE result_count = 0
         AND created_at BETWEEN ? AND ?
       GROUP BY query
       ORDER BY count DESC
       LIMIT ?`)
      .bind(startTime, endTime, limit)
      .all<{ query: string; count: number }>();
    const topNoResultsQueries = topNoResultsQueriesResult.results || [];

    // Searches by type
    const searchesByTypeResultData = await this.db.$client
      .prepare(`SELECT query_type, COUNT(*) as count
       FROM search_queries
       WHERE created_at BETWEEN ? AND ?
       GROUP BY query_type`)
      .bind(startTime, endTime)
      .all<{ query_type: string; count: number }>();
    const searchesByTypeRows = searchesByTypeResultData.results || [];

    const searchesByType = searchesByTypeRows.reduce(
      (acc, row) => {
        acc[row.query_type] = row.count;
        return acc;
      },
      {} as Record<string, number>
    );

    // Searches by hour of day
    const searchesByHourResult = await this.db.$client
      .prepare(`SELECT
         CAST(strftime('%H', datetime(created_at / 1000, 'unixepoch')) AS INTEGER) as hour,
         COUNT(*) as count
       FROM search_queries
       WHERE created_at BETWEEN ? AND ?
       GROUP BY hour
       ORDER BY hour`)
      .bind(startTime, endTime)
      .all<{ hour: number; count: number }>();
    const searchesByHour = searchesByHourResult.results || [];

    const clickThroughRate =
      clickThroughResult && clickThroughResult.total > 0
        ? (clickThroughResult.clicked / clickThroughResult.total) * 100
        : 0;

    const noResultsRate =
      noResultsResult && noResultsResult.total > 0
        ? (noResultsResult.no_results / noResultsResult.total) * 100
        : 0;

    return {
      totalSearches: totalSearchesResult?.count || 0,
      uniqueUsers: uniqueUsersResult?.count || 0,
      avgResultCount: avgResultCountResult?.avg || 0,
      avgResponseTime: avgResponseTimeResult?.avg || 0,
      clickThroughRate,
      noResultsRate,
      topQueries,
      topNoResultsQueries,
      searchesByType,
      searchesByHour
    };
  }

  /**
   * Get popular searches
   */
  async getPopularSearches(limit: number = 20): Promise<
    Array<{
      query: string;
      searchCount: number;
      avgResultCount: number;
      clickThroughRate: number;
      lastSearchedAt: number;
    }>
  > {
    const searchesResult = await this.db.$client
      .prepare(`SELECT
         query,
         search_count,
         avg_result_count,
         click_through_rate,
         last_searched_at
       FROM search_popular
       ORDER BY search_count DESC, last_searched_at DESC
       LIMIT ?`)
      .bind(limit)
      .all<{
        query: string;
        search_count: number;
        avg_result_count: number;
        click_through_rate: number;
        last_searched_at: number;
      }>();
    const searches = searchesResult.results || [];

    return searches.map(s => ({
      query: s.query,
      searchCount: s.search_count,
      avgResultCount: s.avg_result_count,
      clickThroughRate: s.click_through_rate,
      lastSearchedAt: s.last_searched_at
    }));
  }

  /**
   * Get user search history
   */
  async getUserSearchHistory(
    userId: string,
    limit: number = 50
  ): Promise<
    Array<{
      id: string;
      query: string;
      filters?: Record<string, any>;
      resultCount: number;
      clickedResultId?: string;
      createdAt: number;
    }>
  > {
    const historyResult = await this.db.$client
      .prepare(`SELECT
         id,
         query,
         filters,
         result_count,
         clicked_result_id,
         created_at
       FROM search_history
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT ?`)
      .bind(userId, limit)
      .all<{
        id: string;
        query: string;
        filters: string | null;
        result_count: number;
        clicked_result_id: string | null;
        created_at: number;
      }>();
    const history = historyResult.results || [];

    return history.map(h => ({
      id: h.id,
      query: h.query,
      filters: h.filters ? JSON.parse(h.filters) : undefined,
      resultCount: h.result_count,
      clickedResultId: h.clicked_result_id || undefined,
      createdAt: h.created_at
    }));
  }

  /**
   * Save user search to history
   */
  async saveUserSearch(params: {
    userId: string;
    query: string;
    filters?: Record<string, any>;
    resultCount: number;
  }): Promise<void> {
    const id = generateId();
    const now = Date.now();

    await this.db.$client
      .prepare(`INSERT INTO search_history (
        id, user_id, query, filters, result_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(
        id,
        params.userId,
        params.query,
        params.filters ? JSON.stringify(params.filters) : null,
        params.resultCount,
        now
      )
      .run();

    // Keep only last 100 searches per user
    await this.db.$client
      .prepare(`DELETE FROM search_history
       WHERE user_id = ?
         AND id NOT IN (
           SELECT id FROM search_history
           WHERE user_id = ?
           ORDER BY created_at DESC
           LIMIT 100
         )`)
      .bind(params.userId, params.userId)
      .run();
  }

  /**
   * Clear old search data (for privacy/cleanup)
   */
  async clearOldSearchData(daysToKeep: number = 90): Promise<number> {
    const cutoffTime = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;

    const result = await this.db.$client
      .prepare(`DELETE FROM search_queries WHERE created_at < ?`)
      .bind(cutoffTime)
      .run();

    return result.meta.changes || 0;
  }

  /**
   * Get search performance stats
   */
  async getPerformanceStats(): Promise<{
    p50ResponseTime: number;
    p95ResponseTime: number;
    p99ResponseTime: number;
    slowestQueries: Array<{ query: string; responseTime: number }>;
  }> {
    // Calculate percentiles
    const allResponseTimesResult = await this.db.$client
      .prepare(`SELECT response_time_ms
       FROM search_queries
       WHERE response_time_ms IS NOT NULL
       ORDER BY response_time_ms`)
      .all<{ response_time_ms: number }>();
    const allResponseTimes = allResponseTimesResult.results || [];

    const times = allResponseTimes.map(r => r.response_time_ms);
    const count = times.length;

    if (count === 0) {
      return {
        p50ResponseTime: 0,
        p95ResponseTime: 0,
        p99ResponseTime: 0,
        slowestQueries: []
      };
    }

    const p50 = times[Math.floor(count * 0.5)];
    const p95 = times[Math.floor(count * 0.95)];
    const p99 = times[Math.floor(count * 0.99)];

    // Get slowest queries
    const slowestQueriesResult = await this.db.$client
      .prepare(`SELECT query, response_time_ms
       FROM search_queries
       ORDER BY response_time_ms DESC
       LIMIT 10`)
      .all<{
        query: string;
        response_time_ms: number;
      }>();
    const slowestQueries = slowestQueriesResult.results || [];

    return {
      p50ResponseTime: p50,
      p95ResponseTime: p95,
      p99ResponseTime: p99,
      slowestQueries: slowestQueries.map(q => ({
        query: q.query,
        responseTime: q.response_time_ms
      }))
    };
  }
}
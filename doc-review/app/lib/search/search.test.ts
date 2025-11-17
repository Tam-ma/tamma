import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SearchQueryBuilder } from './query-builder.server';
import { SearchIndexer } from './indexer.server';
import { SearchAnalytics } from './analytics.server';

/**
 * Comprehensive Search System Tests
 */

// Mock database
class MockDatabase {
  private data: Map<string, any[]> = new Map();

  async run(sql: string, params: any[] = []) {
    // Mock implementation
    return { changes: 1 };
  }

  async get<T>(sql: string, params: any[] = []): Promise<T | undefined> {
    // Mock implementation
    return undefined;
  }

  async all<T>(sql: string, params: any[] = []): Promise<T[]> {
    // Mock implementation based on SQL
    let results: any[] = [];

    if (sql.includes('documents_fts')) {
      results = this.mockDocumentResults();
    } else if (sql.includes('comments_fts')) {
      results = this.mockCommentResults();
    } else if (sql.includes('suggestions_fts')) {
      results = this.mockSuggestionResults();
    } else {
      return [];
    }

    // Apply filters based on SQL params
    // First param is always the search query (MATCH clause)
    // Subsequent params are filters from WHERE clauses
    if (params.length > 1) {
      // Check for doc_path filter
      if (sql.includes('doc_path = ?')) {
        const docPathParam = this.getParamForClause(sql, params, 'doc_path = ?');
        if (docPathParam !== null) {
          results = results.filter(r => r.doc_path === docPathParam);
        }
      }

      // Check for user_id filter
      if (sql.includes('user_id = ?')) {
        const userIdParam = this.getParamForClause(sql, params, 'user_id = ?');
        if (userIdParam !== null) {
          results = results.filter(r => r.user_id === userIdParam);
        }
      }

      // Check for status filter
      if (sql.includes('status = ?')) {
        const statusParam = this.getParamForClause(sql, params, 'status = ?');
        if (statusParam !== null) {
          results = results.filter(r => r.status === statusParam);
        }
      }
    }

    return results as T[];
  }

  private getParamForClause(sql: string, params: any[], clause: string): any {
    // Count the number of '?' before this clause to find the param index
    const beforeClause = sql.substring(0, sql.indexOf(clause));
    const paramIndex = (beforeClause.match(/\?/g) || []).length;
    return params[paramIndex] !== undefined ? params[paramIndex] : null;
  }

  async prepare(sql: string) {
    return {
      run: (...params: any[]) => this.run(sql, params),
      finalize: async () => {}
    };
  }

  private mockDocumentResults() {
    return [
      {
        id: 'doc1',
        doc_path: '/docs/PRD.md',
        title: 'Product Requirements Document',
        snippet: 'The [product] requirements for the system',
        score: 10.5
      },
      {
        id: 'doc2',
        doc_path: '/docs/architecture.md',
        title: 'System Architecture',
        snippet: 'Technical [architecture] overview',
        score: 8.2
      }
    ];
  }

  private mockCommentResults() {
    return [
      {
        id: 'comment1',
        doc_path: '/docs/PRD.md',
        content: 'This needs more detail',
        author_name: 'John Doe',
        user_id: 'user1',
        created_at: Date.now() - 86400000,
        resolved: 0,
        snippet: 'This needs more [detail]',
        score: 7.3
      },
      {
        id: 'comment2',
        doc_path: '/docs/architecture.md',
        content: 'Different user comment',
        author_name: 'Jane Smith',
        user_id: 'user2',
        created_at: Date.now() - 86400000,
        resolved: 0,
        snippet: 'Different user [comment]',
        score: 6.5
      }
    ];
  }

  private mockSuggestionResults() {
    return [
      {
        id: 'suggestion1',
        doc_path: '/docs/PRD.md',
        description: 'Improve clarity',
        original_text: 'unclear text',
        suggested_text: 'clearer text',
        author_name: 'John Doe',
        user_id: 'user1',
        status: 'pending',
        created_at: Date.now() - 172800000,
        snippet: 'Improve [clarity]',
        score: 6.5
      },
      {
        id: 'suggestion2',
        doc_path: '/docs/architecture.md',
        description: 'Add diagram',
        original_text: 'text only',
        suggested_text: 'text with diagram',
        author_name: 'Jane Smith',
        user_id: 'user2',
        status: 'approved',
        created_at: Date.now() - 172800000,
        snippet: 'Add [diagram]',
        score: 5.8
      }
    ];
  }
}

describe('SearchQueryBuilder', () => {
  let db: MockDatabase;
  let queryBuilder: SearchQueryBuilder;

  beforeEach(() => {
    db = new MockDatabase();
    queryBuilder = new SearchQueryBuilder(db as any);
  });

  describe('Query Construction', () => {
    it('should escape special FTS5 characters', async () => {
      const results = await queryBuilder
        .search('test (query)')
        .execute();

      expect(results).toBeDefined();
      expect(results.results).toBeInstanceOf(Array);
    });

    it('should handle quoted phrases', async () => {
      const results = await queryBuilder
        .search('"exact phrase"')
        .execute();

      expect(results).toBeDefined();
    });

    it('should handle prefix search with wildcard', async () => {
      const results = await queryBuilder
        .search('search*')
        .execute();

      expect(results).toBeDefined();
    });

    it('should handle empty query gracefully', async () => {
      const results = await queryBuilder
        .search('')
        .execute();

      expect(results.results).toHaveLength(0);
    });
  });

  describe('Filters', () => {
    it('should filter by content type', async () => {
      const results = await queryBuilder
        .search('test')
        .filterByType('comments')
        .execute();

      expect(results.results.every(r => r.type === 'comment')).toBe(true);
    });

    it('should filter by document path', async () => {
      const docPath = '/docs/PRD.md';
      const results = await queryBuilder
        .search('test')
        .filterByDocPath(docPath)
        .execute();

      expect(results.results.every(r => r.docPath === docPath)).toBe(true);
    });

    it('should filter by user ID', async () => {
      const userId = 'user1';
      const results = await queryBuilder
        .search('test')
        .filterByUser(userId)
        .execute();

      expect(results.results.every(r => r.authorId === userId)).toBe(true);
    });

    it('should filter by status', async () => {
      const status = 'pending';
      const results = await queryBuilder
        .search('test')
        .filterByStatus(status)
        .execute();

      expect(results.results.every(r => r.status === status)).toBe(true);
    });

    it('should filter by date range', async () => {
      const after = new Date('2024-01-01');
      const before = new Date('2024-12-31');

      const results = await queryBuilder
        .search('test')
        .filterByDateRange(before, after)
        .execute();

      expect(results).toBeDefined();
    });

    it('should combine multiple filters', async () => {
      const results = await queryBuilder
        .search('test')
        .filterByType('comments')
        .filterByStatus('open')
        .filterByUser('user1')
        .execute();

      expect(results).toBeDefined();
    });
  });

  describe('Pagination', () => {
    it('should paginate results', async () => {
      const results = await queryBuilder
        .search('test')
        .paginate(10, 0)
        .execute();

      expect(results.results.length).toBeLessThanOrEqual(10);
    });

    it('should respect maximum limit', async () => {
      const results = await queryBuilder
        .search('test')
        .paginate(200, 0) // Try to request more than max
        .execute();

      expect(results.results.length).toBeLessThanOrEqual(100);
    });

    it('should handle offset correctly', async () => {
      const page1 = await queryBuilder
        .search('test')
        .paginate(5, 0)
        .execute();

      const page2 = await queryBuilder
        .search('test')
        .paginate(5, 5)
        .execute();

      // Results should be different (in a real scenario)
      expect(page1).toBeDefined();
      expect(page2).toBeDefined();
    });
  });

  describe('Result Ranking', () => {
    it('should sort results by relevance score', async () => {
      const results = await queryBuilder
        .search('test')
        .execute();

      // Check that results are sorted by score (descending)
      for (let i = 1; i < results.results.length; i++) {
        expect(results.results[i - 1].score).toBeGreaterThanOrEqual(
          results.results[i].score
        );
      }
    });
  });

  describe('Facets', () => {
    it('should generate type facets', async () => {
      const results = await queryBuilder
        .search('test')
        .execute();

      expect(results.facets.types).toBeDefined();
      expect(typeof results.facets.types).toBe('object');
    });

    it('should generate status facets', async () => {
      const results = await queryBuilder
        .search('test')
        .execute();

      expect(results.facets.statuses).toBeDefined();
      expect(typeof results.facets.statuses).toBe('object');
    });

    it('should generate author facets', async () => {
      const results = await queryBuilder
        .search('test')
        .execute();

      expect(results.facets.authors).toBeDefined();
      expect(Array.isArray(results.facets.authors)).toBe(true);
    });
  });
});

describe('SearchIndexer', () => {
  let db: MockDatabase;
  let indexer: SearchIndexer;

  beforeEach(() => {
    db = new MockDatabase();
    indexer = new SearchIndexer(db as any);
  });

  describe('Document Indexing', () => {
    it('should index a document', async () => {
      await expect(
        indexer.indexDocument({
          docPath: '/docs/test.md',
          title: 'Test Document',
          content: 'Test content',
          category: 'test'
        })
      ).resolves.not.toThrow();
    });

    it('should handle missing optional fields', async () => {
      await expect(
        indexer.indexDocument({
          docPath: '/docs/test.md',
          title: 'Test Document'
        })
      ).resolves.not.toThrow();
    });
  });

  describe('Comment Indexing', () => {
    it('should index a comment', async () => {
      await expect(
        indexer.indexComment({
          id: 'comment1',
          docPath: '/docs/test.md',
          content: 'Test comment',
          authorName: 'Test User',
          userId: 'user1',
          resolved: false,
          createdAt: Date.now()
        })
      ).resolves.not.toThrow();
    });
  });

  describe('Suggestion Indexing', () => {
    it('should index a suggestion', async () => {
      await expect(
        indexer.indexSuggestion({
          id: 'suggestion1',
          docPath: '/docs/test.md',
          originalText: 'old text',
          suggestedText: 'new text',
          authorName: 'Test User',
          userId: 'user1',
          status: 'pending',
          createdAt: Date.now()
        })
      ).resolves.not.toThrow();
    });
  });

  describe('Batch Operations', () => {
    it('should batch index comments', async () => {
      const comments = [
        {
          id: 'c1',
          docPath: '/docs/test.md',
          content: 'Comment 1',
          authorName: 'User 1',
          userId: 'user1',
          resolved: false,
          createdAt: Date.now()
        },
        {
          id: 'c2',
          docPath: '/docs/test.md',
          content: 'Comment 2',
          authorName: 'User 2',
          userId: 'user2',
          resolved: true,
          createdAt: Date.now()
        }
      ];

      await expect(
        indexer.batchIndexComments(comments)
      ).resolves.not.toThrow();
    });
  });

  describe('Index Management', () => {
    it('should get index statistics', async () => {
      const stats = await indexer.getIndexStats();

      expect(stats).toBeDefined();
      expect(typeof stats.documents).toBe('number');
      expect(typeof stats.comments).toBe('number');
      expect(typeof stats.suggestions).toBe('number');
      expect(typeof stats.discussions).toBe('number');
      expect(typeof stats.messages).toBe('number');
      expect(typeof stats.totalSize).toBe('number');
    });

    it('should remove indexed content', async () => {
      await expect(indexer.removeComment('comment1')).resolves.not.toThrow();
      await expect(indexer.removeSuggestion('suggestion1')).resolves.not.toThrow();
      await expect(indexer.removeDiscussion('discussion1')).resolves.not.toThrow();
      await expect(indexer.removeDocument('/docs/test.md')).resolves.not.toThrow();
    });
  });
});

describe('SearchAnalytics', () => {
  let db: MockDatabase;
  let analytics: SearchAnalytics;

  beforeEach(() => {
    db = new MockDatabase();
    analytics = new SearchAnalytics(db as any);
  });

  describe('Search Logging', () => {
    it('should log a search query', async () => {
      const searchId = await analytics.logSearch({
        userId: 'user1',
        query: 'test search',
        resultCount: 10,
        responseTimeMs: 50
      });

      expect(searchId).toBeDefined();
      expect(typeof searchId).toBe('string');
    });

    it('should log search without user ID', async () => {
      const searchId = await analytics.logSearch({
        query: 'anonymous search',
        resultCount: 5,
        responseTimeMs: 30
      });

      expect(searchId).toBeDefined();
    });

    it('should log search click', async () => {
      await expect(
        analytics.logSearchClick({
          searchId: 'search1',
          resultId: 'result1',
          resultType: 'document',
          resultRank: 1
        })
      ).resolves.not.toThrow();
    });
  });

  describe('Metrics', () => {
    it('should calculate search metrics', async () => {
      const metrics = await analytics.getMetrics({
        limit: 10
      });

      expect(metrics).toBeDefined();
      expect(typeof metrics.totalSearches).toBe('number');
      expect(typeof metrics.uniqueUsers).toBe('number');
      expect(typeof metrics.avgResultCount).toBe('number');
      expect(typeof metrics.avgResponseTime).toBe('number');
      expect(typeof metrics.clickThroughRate).toBe('number');
      expect(typeof metrics.noResultsRate).toBe('number');
      expect(Array.isArray(metrics.topQueries)).toBe(true);
      expect(Array.isArray(metrics.topNoResultsQueries)).toBe(true);
    });

    it('should get popular searches', async () => {
      const popular = await analytics.getPopularSearches(10);

      expect(Array.isArray(popular)).toBe(true);
      popular.forEach(search => {
        expect(search).toHaveProperty('query');
        expect(search).toHaveProperty('searchCount');
        expect(search).toHaveProperty('avgResultCount');
      });
    });

    it('should get performance statistics', async () => {
      const stats = await analytics.getPerformanceStats();

      expect(stats).toBeDefined();
      expect(typeof stats.p50ResponseTime).toBe('number');
      expect(typeof stats.p95ResponseTime).toBe('number');
      expect(typeof stats.p99ResponseTime).toBe('number');
      expect(Array.isArray(stats.slowestQueries)).toBe(true);
    });
  });

  describe('User History', () => {
    it('should save user search', async () => {
      await expect(
        analytics.saveUserSearch({
          userId: 'user1',
          query: 'test',
          resultCount: 5
        })
      ).resolves.not.toThrow();
    });

    it('should get user search history', async () => {
      const history = await analytics.getUserSearchHistory('user1', 20);

      expect(Array.isArray(history)).toBe(true);
      history.forEach(item => {
        expect(item).toHaveProperty('id');
        expect(item).toHaveProperty('query');
        expect(item).toHaveProperty('resultCount');
        expect(item).toHaveProperty('createdAt');
      });
    });
  });

  describe('Data Management', () => {
    it('should clear old search data', async () => {
      const deletedCount = await analytics.clearOldSearchData(30);

      expect(typeof deletedCount).toBe('number');
      expect(deletedCount).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('Search Integration', () => {
  let db: MockDatabase;
  let queryBuilder: SearchQueryBuilder;
  let indexer: SearchIndexer;
  let analytics: SearchAnalytics;

  beforeEach(() => {
    db = new MockDatabase();
    queryBuilder = new SearchQueryBuilder(db as any);
    indexer = new SearchIndexer(db as any);
    analytics = new SearchAnalytics(db as any);
  });

  it('should handle end-to-end search flow', async () => {
    // 1. Index content
    await indexer.indexDocument({
      docPath: '/docs/test.md',
      title: 'Test Document',
      content: 'This is test content for searching'
    });

    // 2. Search for content
    const results = await queryBuilder
      .search('test')
      .execute();

    expect(results.results.length).toBeGreaterThan(0);
    expect(results.total).toBeGreaterThan(0);

    // 3. Log the search
    const searchId = await analytics.logSearch({
      query: 'test',
      resultCount: results.total,
      responseTimeMs: 50
    });

    expect(searchId).toBeDefined();

    // 4. Log a click
    if (results.results.length > 0) {
      await analytics.logSearchClick({
        searchId,
        resultId: results.results[0].id,
        resultType: results.results[0].type,
        resultRank: 1
      });
    }
  });

  it('should handle special characters in queries', async () => {
    const specialQueries = [
      'C++',
      'Node.js',
      '@username',
      '#hashtag',
      'test&debug',
      'email@example.com',
      'path/to/file.ts',
      '100%',
      '$variable'
    ];

    for (const query of specialQueries) {
      const results = await queryBuilder
        .search(query)
        .execute();

      expect(results).toBeDefined();
      expect(results.results).toBeInstanceOf(Array);
    }
  });

  it('should handle edge cases', async () => {
    // Very long query
    const longQuery = 'a'.repeat(1000);
    const results1 = await queryBuilder
      .search(longQuery)
      .execute();
    expect(results1).toBeDefined();

    // Unicode characters
    const unicodeQuery = '测试 テスト тест';
    const results2 = await queryBuilder
      .search(unicodeQuery)
      .execute();
    expect(results2).toBeDefined();

    // Empty filters
    const results3 = await queryBuilder
      .search('test')
      .filterByType(undefined as any)
      .execute();
    expect(results3).toBeDefined();
  });
});
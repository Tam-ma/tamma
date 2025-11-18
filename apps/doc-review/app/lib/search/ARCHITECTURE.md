# Search Architecture Documentation

## Technology Decision: D1 FTS5 (SQLite Full-Text Search)

### Executive Summary
We have chosen to implement full-text search using Cloudflare D1's native FTS5 (Full-Text Search version 5) extension. This decision provides optimal performance, minimal latency, and seamless integration with our existing D1 database infrastructure.

## Technology Options Evaluated

### 1. **D1 FTS5 (CHOSEN)**
- **Pros:**
  - Native SQLite extension, no external dependencies
  - Sub-10ms query latency for most searches
  - Zero additional infrastructure cost
  - Supports advanced features: phrase search, prefix search, ranking
  - Built-in Porter stemmer for English text
  - Seamless integration with existing D1 database
  - Automatic tokenization and indexing
  - Support for multiple languages via tokenizers

- **Cons:**
  - Limited to SQLite FTS5 capabilities
  - No vector/semantic search capabilities
  - Manual index maintenance required
  - No built-in typo tolerance (fuzzy matching)

### 2. Cloudflare Vectorize
- **Pros:**
  - Semantic search capabilities
  - Better handling of synonyms and context
  - AI-powered relevance

- **Cons:**
  - Additional service dependency
  - Higher latency (50-200ms)
  - Requires embedding generation
  - Additional costs
  - More complex implementation

### 3. External Services (Algolia, Elasticsearch)
- **Pros:**
  - Advanced search features
  - Built-in typo tolerance
  - Faceted search out-of-the-box
  - Analytics included

- **Cons:**
  - External service dependency
  - Network latency (50-500ms)
  - Monthly subscription costs
  - Data synchronization complexity
  - Privacy/compliance concerns

## Architecture Design

### Search Index Structure

We maintain four separate FTS5 virtual tables for different entity types:

1. **documents_fts** - Full document content and metadata
2. **comments_fts** - User comments with context
3. **suggestions_fts** - Edit suggestions with descriptions
4. **discussions_fts** - Discussion threads and messages

### Data Flow

```
User Query
    ↓
Search API Endpoint
    ↓
Query Builder (construct FTS5 queries)
    ↓
D1 FTS5 Tables
    ↓
Result Ranking & Scoring
    ↓
Response Formatting
    ↓
Client (with highlighted matches)
```

### Indexing Strategy

1. **Real-time indexing**: Content indexed immediately on create/update
2. **Batch re-indexing**: Full re-index capability for maintenance
3. **Incremental updates**: Only modified content re-indexed
4. **Soft deletes**: Maintain index integrity with deletion flags

### Search Features

#### Core Features (Implemented)
- Full-text search across all content types
- Phrase search with quotes ("exact phrase")
- Prefix search (searchterm*)
- Boolean operators (AND, OR, NOT)
- Field-specific search
- Date range filtering
- Author filtering
- Status filtering
- Pagination with offset/limit

#### Advanced Features (Planned)
- Search suggestions/autocomplete
- Recent searches
- Popular searches
- Search analytics
- Saved searches
- Search history per user

### Performance Optimizations

1. **Index Configuration**
   - Porter stemmer for English text normalization
   - Unicode61 tokenizer for international support
   - Column weights for relevance tuning

2. **Query Optimization**
   - Prepared statements for common queries
   - Result limiting with early termination
   - Index-only scans where possible

3. **Caching Strategy**
   - Edge caching for popular searches (5-minute TTL)
   - Browser caching for autocomplete suggestions
   - No caching for personalized results

### Security Considerations

1. **Input Sanitization**
   - Escape special FTS5 characters
   - Parameterized queries to prevent injection
   - Query length limits (max 1000 chars)

2. **Access Control**
   - Respect document permissions
   - Filter results by user access level
   - Admin-only search analytics

3. **Rate Limiting**
   - 100 searches per minute per user
   - 10 autocomplete requests per second
   - Circuit breaker for database protection

## Implementation Phases

### Phase 1: Core Search (Current)
- FTS5 table creation
- Basic indexing
- Simple search API
- Text highlighting

### Phase 2: Advanced Features
- Autocomplete
- Faceted filtering
- Search analytics
- Admin dashboard

### Phase 3: Optimizations
- Query performance tuning
- Caching layer
- Batch indexing improvements
- Search suggestions ML model

## Monitoring & Metrics

Key metrics to track:
- Search response time (p50, p95, p99)
- Query volume
- No-results rate
- Click-through rate
- Popular search terms
- Index size and growth

## Migration Path

If we need to migrate to a different search solution:
1. Export search analytics to understand usage patterns
2. Implement new solution in parallel
3. Dual-write to both systems during transition
4. A/B test search quality
5. Gradual migration with fallback
6. Decommission FTS5 tables once stable

## Conclusion

D1 FTS5 provides the optimal balance of performance, cost, and complexity for our search requirements. It integrates seamlessly with our existing infrastructure while providing sub-10ms search latency and advanced full-text search capabilities. The architecture is designed to be extensible, allowing for future enhancements or migration if needed.
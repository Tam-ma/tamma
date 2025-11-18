-- Full-Text Search Migration for D1
-- Adds FTS5 virtual tables for searching across documents, comments, suggestions, and discussions

-- Documents FTS table
-- Indexes document content and metadata for full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
  doc_path UNINDEXED,           -- Store but don't index (for retrieval)
  title,                         -- Document title (weighted higher)
  content,                       -- Full document content
  category,                      -- Document category
  tokenize='porter unicode61',  -- Porter stemmer for English, Unicode support
  content=document_metadata      -- Links to source table for updates
);

-- Trigger to keep documents_fts in sync with document_metadata
CREATE TRIGGER IF NOT EXISTS document_metadata_ai AFTER INSERT ON document_metadata
BEGIN
  INSERT INTO documents_fts(doc_path, title, content, category)
  VALUES (new.doc_path, new.title, new.description, new.category);
END;

CREATE TRIGGER IF NOT EXISTS document_metadata_ad AFTER DELETE ON document_metadata
BEGIN
  DELETE FROM documents_fts WHERE doc_path = old.doc_path;
END;

CREATE TRIGGER IF NOT EXISTS document_metadata_au AFTER UPDATE ON document_metadata
BEGIN
  DELETE FROM documents_fts WHERE doc_path = old.doc_path;
  INSERT INTO documents_fts(doc_path, title, content, category)
  VALUES (new.doc_path, new.title, new.description, new.category);
END;

-- Comments FTS table
-- Indexes comment content with author and document context
CREATE VIRTUAL TABLE IF NOT EXISTS comments_fts USING fts5(
  comment_id UNINDEXED,         -- Store but don't index
  doc_path UNINDEXED,           -- For filtering
  content,                       -- Comment text
  author_name,                  -- Author name for search
  line_content,                  -- Context of the commented line
  user_id UNINDEXED,            -- For filtering
  created_at UNINDEXED,         -- For date filtering
  resolved UNINDEXED,           -- For status filtering
  tokenize='porter unicode61'
);

-- Suggestions FTS table
-- Indexes suggestion descriptions and text changes
CREATE VIRTUAL TABLE IF NOT EXISTS suggestions_fts USING fts5(
  suggestion_id UNINDEXED,      -- Store but don't index
  doc_path UNINDEXED,           -- For filtering
  description,                   -- Suggestion description (weighted higher)
  original_text,                -- Original text
  suggested_text,               -- Suggested replacement
  author_name,                  -- Author name for search
  user_id UNINDEXED,            -- For filtering
  status UNINDEXED,             -- For status filtering
  created_at UNINDEXED,         -- For date filtering
  tokenize='porter unicode61'
);

-- Discussions FTS table
-- Indexes discussion titles and descriptions
CREATE VIRTUAL TABLE IF NOT EXISTS discussions_fts USING fts5(
  discussion_id UNINDEXED,      -- Store but don't index
  doc_path UNINDEXED,           -- For filtering
  title,                         -- Discussion title (weighted higher)
  description,                   -- Discussion description
  author_name,                  -- Author name for search
  user_id UNINDEXED,            -- For filtering
  status UNINDEXED,             -- For status filtering
  created_at UNINDEXED,         -- For date filtering
  tokenize='porter unicode61'
);

-- Discussion Messages FTS table
-- Indexes individual messages within discussions
CREATE VIRTUAL TABLE IF NOT EXISTS discussion_messages_fts USING fts5(
  message_id UNINDEXED,         -- Store but don't index
  discussion_id UNINDEXED,      -- For joining with discussions
  content,                       -- Message content
  author_name,                  -- Author name for search
  user_id UNINDEXED,            -- For filtering
  created_at UNINDEXED,         -- For date filtering
  tokenize='porter unicode61'
);

-- Search Analytics table
-- Tracks search queries for analytics and improving search
CREATE TABLE IF NOT EXISTS search_queries (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT,                              -- NULL for anonymous searches
  session_id TEXT,                           -- Track search sessions
  query TEXT NOT NULL,                       -- The search query
  query_type TEXT DEFAULT 'full_text',       -- full_text, autocomplete, filter
  filters TEXT,                              -- JSON of applied filters
  result_count INTEGER NOT NULL DEFAULT 0,   -- Number of results returned
  clicked_result_id TEXT,                    -- ID of clicked result (if any)
  clicked_result_type TEXT,                  -- Type: document, comment, suggestion, discussion
  clicked_result_rank INTEGER,               -- Position in results (1-based)
  response_time_ms INTEGER,                  -- Query execution time
  created_at INTEGER NOT NULL                -- Unix timestamp (ms)
);

-- Indexes for search analytics
CREATE INDEX IF NOT EXISTS idx_search_queries_user_id ON search_queries(user_id);
CREATE INDEX IF NOT EXISTS idx_search_queries_session_id ON search_queries(session_id);
CREATE INDEX IF NOT EXISTS idx_search_queries_created_at ON search_queries(created_at);
CREATE INDEX IF NOT EXISTS idx_search_queries_query_type ON search_queries(query_type);
CREATE INDEX IF NOT EXISTS idx_search_queries_result_count ON search_queries(result_count);

-- Popular searches aggregation (materialized view alternative)
CREATE TABLE IF NOT EXISTS search_popular (
  id TEXT PRIMARY KEY NOT NULL,
  query TEXT NOT NULL UNIQUE,
  search_count INTEGER NOT NULL DEFAULT 1,
  last_searched_at INTEGER NOT NULL,
  avg_result_count REAL DEFAULT 0,
  click_through_rate REAL DEFAULT 0,        -- Percentage of searches with clicks
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_search_popular_count ON search_popular(search_count DESC);
CREATE INDEX IF NOT EXISTS idx_search_popular_last ON search_popular(last_searched_at DESC);

-- User search history
CREATE TABLE IF NOT EXISTS search_history (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  query TEXT NOT NULL,
  filters TEXT,                              -- JSON of applied filters
  result_count INTEGER NOT NULL DEFAULT 0,
  clicked_result_id TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_search_history_user_id ON search_history(user_id, created_at DESC);

-- Saved searches for users
CREATE TABLE IF NOT EXISTS saved_searches (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,                        -- User-defined name
  query TEXT NOT NULL,
  filters TEXT,                              -- JSON of filters
  notification_enabled BOOLEAN DEFAULT FALSE, -- Notify on new matches
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_saved_searches_user_id ON saved_searches(user_id);

-- FTS5 Configuration: Set ranking weights
-- Title/description matches are weighted higher than content matches
INSERT INTO documents_fts(documents_fts, rank) VALUES('rank', 'bm25(10.0, 5.0, 1.0, 1.0)');
INSERT INTO comments_fts(comments_fts, rank) VALUES('rank', 'bm25(0.0, 0.0, 10.0, 2.0, 1.0, 0.0, 0.0, 0.0)');
INSERT INTO suggestions_fts(suggestions_fts, rank) VALUES('rank', 'bm25(0.0, 0.0, 10.0, 2.0, 2.0, 1.0, 0.0, 0.0, 0.0)');
INSERT INTO discussions_fts(discussions_fts, rank) VALUES('rank', 'bm25(0.0, 0.0, 10.0, 5.0, 1.0, 0.0, 0.0, 0.0)');
INSERT INTO discussion_messages_fts(discussion_messages_fts, rank) VALUES('rank', 'bm25(0.0, 0.0, 10.0, 1.0, 0.0, 0.0)');
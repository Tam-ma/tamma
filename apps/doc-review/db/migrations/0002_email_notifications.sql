-- Email queue table for managing email sends
CREATE TABLE IF NOT EXISTS email_queue (
  id TEXT PRIMARY KEY,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  html TEXT NOT NULL,
  text TEXT,
  user_id TEXT,
  type TEXT NOT NULL, -- comment_notification, suggestion_notification, review_request, digest, other
  status TEXT NOT NULL DEFAULT 'pending', -- pending, processing, sent, failed
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at INTEGER,
  sent_at INTEGER,
  failed_at INTEGER,
  error TEXT,
  metadata TEXT, -- JSON string for additional data
  created_at INTEGER NOT NULL,
  scheduled_for INTEGER
);

-- Index for queue processing
CREATE INDEX IF NOT EXISTS idx_email_queue_status ON email_queue(status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_email_queue_user ON email_queue(user_id);

-- Email log for sent emails
CREATE TABLE IF NOT EXISTS email_log (
  id TEXT PRIMARY KEY,
  queue_id TEXT NOT NULL,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  type TEXT NOT NULL,
  user_id TEXT,
  sent_at INTEGER NOT NULL,
  resend_id TEXT, -- External provider's email ID
  metadata TEXT
);

-- Index for email history lookup
CREATE INDEX IF NOT EXISTS idx_email_log_user ON email_log(user_id);
CREATE INDEX IF NOT EXISTS idx_email_log_sent ON email_log(sent_at);

-- Notification preferences table
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id TEXT PRIMARY KEY,
  comment_replies INTEGER DEFAULT 1, -- Boolean as integer
  new_comments INTEGER DEFAULT 1,
  new_suggestions INTEGER DEFAULT 1,
  suggestion_status INTEGER DEFAULT 1,
  review_requests INTEGER DEFAULT 1,
  digest_frequency TEXT DEFAULT 'none', -- 'none', 'daily', 'weekly'
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Document watch list for following specific documents
CREATE TABLE IF NOT EXISTS document_watches (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  doc_path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, doc_path)
);

-- Index for watch lookups
CREATE INDEX IF NOT EXISTS idx_document_watches_user ON document_watches(user_id);
CREATE INDEX IF NOT EXISTS idx_document_watches_doc ON document_watches(doc_path);
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const timestamp = () =>
  integer('created_at', { mode: 'number' })
    .notNull();

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  avatarUrl: text('avatar_url'),
  role: text('role').notNull().default('viewer'),
  createdAt: timestamp(),
  updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
});

export const reviewSessions = sqliteTable('review_sessions', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  summary: text('summary'),
  docPaths: text('doc_paths').notNull(), // JSON string of paths
  primaryDocPath: text('primary_doc_path').notNull(),
  branch: text('branch'),
  prNumber: integer('pr_number'),
  prUrl: text('pr_url'),
  status: text('status').notNull().default('draft'),
  ownerId: text('owner_id').notNull(),
  createdAt: timestamp(),
  updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
});

export const comments = sqliteTable('comments', {
  id: text('id').primaryKey(),
  docPath: text('doc_path').notNull(),
  lineNumber: integer('line_number'),
  lineContent: text('line_content'),
  content: text('content').notNull(),
  userId: text('user_id').notNull(),
  parentId: text('parent_id'),
  resolved: integer('resolved', { mode: 'boolean' }).notNull().default(false),
  createdAt: timestamp(),
  updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
  deletedAt: integer('deleted_at', { mode: 'number' }),
});

export const suggestions = sqliteTable('suggestions', {
  id: text('id').primaryKey(),
  docPath: text('doc_path').notNull(),
  lineStart: integer('line_start').notNull(),
  lineEnd: integer('line_end').notNull(),
  originalText: text('original_text').notNull(),
  suggestedText: text('suggested_text').notNull(),
  description: text('description'),
  status: text('status').notNull().default('pending'),
  reviewedBy: text('reviewed_by'),
  reviewedAt: integer('reviewed_at', { mode: 'number' }),
  userId: text('user_id').notNull(),
  sessionId: text('session_id'),
  createdAt: timestamp(),
  updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
  deletedAt: integer('deleted_at', { mode: 'number' }),
});

export const discussions = sqliteTable('discussions', {
  id: text('id').primaryKey(),
  docPath: text('doc_path').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').notNull().default('open'),
  userId: text('user_id').notNull(),
  sessionId: text('session_id'),
  createdAt: timestamp(),
  updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
  deletedAt: integer('deleted_at', { mode: 'number' }),
});

export const discussionMessages = sqliteTable('discussion_messages', {
  id: text('id').primaryKey(),
  discussionId: text('discussion_id').notNull(),
  content: text('content').notNull(),
  userId: text('user_id').notNull(),
  createdAt: timestamp(),
  updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
  deletedAt: integer('deleted_at', { mode: 'number' }),
});

export const documentMetadata = sqliteTable('document_metadata', {
  docPath: text('doc_path').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  category: text('category'),
  epicId: text('epic_id'),
  storyId: text('story_id'),
  wordCount: integer('word_count'),
  lineCount: integer('line_count'),
  lastModified: integer('last_modified', { mode: 'number' }).notNull(),
  createdAt: timestamp(),
  updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
});

export const activityLog = sqliteTable('activity_log', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  action: text('action').notNull(),
  resourceType: text('resource_type').notNull(),
  resourceId: text('resource_id').notNull(),
  metadata: text('metadata'),
  createdAt: timestamp(),
});

// Email queue table
export const emailQueue = sqliteTable('email_queue', {
  id: text('id').primaryKey(),
  toEmail: text('to_email').notNull(),
  subject: text('subject').notNull(),
  html: text('html').notNull(),
  text: text('text'),
  userId: text('user_id'),
  type: text('type').notNull(),
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  lastAttemptAt: integer('last_attempt_at', { mode: 'number' }),
  sentAt: integer('sent_at', { mode: 'number' }),
  failedAt: integer('failed_at', { mode: 'number' }),
  error: text('error'),
  metadata: text('metadata'),
  createdAt: timestamp(),
  scheduledFor: integer('scheduled_for', { mode: 'number' }),
});

// Email log table
export const emailLog = sqliteTable('email_log', {
  id: text('id').primaryKey(),
  queueId: text('queue_id').notNull(),
  toEmail: text('to_email').notNull(),
  subject: text('subject').notNull(),
  type: text('type').notNull(),
  userId: text('user_id'),
  sentAt: integer('sent_at', { mode: 'number' }).notNull(),
  resendId: text('resend_id'),
  metadata: text('metadata'),
});

// Notification preferences table
export const notificationPreferences = sqliteTable('notification_preferences', {
  userId: text('user_id').primaryKey(),
  commentReplies: integer('comment_replies', { mode: 'boolean' }).notNull().default(true),
  newComments: integer('new_comments', { mode: 'boolean' }).notNull().default(true),
  newSuggestions: integer('new_suggestions', { mode: 'boolean' }).notNull().default(true),
  suggestionStatus: integer('suggestion_status', { mode: 'boolean' }).notNull().default(true),
  reviewRequests: integer('review_requests', { mode: 'boolean' }).notNull().default(true),
  digestFrequency: text('digest_frequency').notNull().default('none'),
  createdAt: timestamp(),
  updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
});

// Document watches table
export const documentWatches = sqliteTable('document_watches', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  docPath: text('doc_path').notNull(),
  createdAt: timestamp(),
});

export type CommentRecord = typeof comments.$inferSelect;
export type SuggestionRecord = typeof suggestions.$inferSelect;
export type DiscussionRecord = typeof discussions.$inferSelect;
export type ReviewSessionRecord = typeof reviewSessions.$inferSelect;
export type NotificationPreferencesRecord = typeof notificationPreferences.$inferSelect;
export type DocumentWatchRecord = typeof documentWatches.$inferSelect;
export type EmailQueueRecord = typeof emailQueue.$inferSelect;
export type EmailLogRecord = typeof emailLog.$inferSelect;

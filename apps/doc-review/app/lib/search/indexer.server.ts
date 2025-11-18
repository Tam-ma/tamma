import type { Database } from '../db/client.server';

/**
 * Search Indexer Service
 * Manages FTS5 index updates for all searchable content
 */

interface IndexableDocument {
  docPath: string;
  title: string;
  content?: string;
  category?: string;
}

interface IndexableComment {
  id: string;
  docPath: string;
  content: string;
  authorName: string;
  userId: string;
  lineContent?: string | null;
  resolved: boolean;
  createdAt: number;
}

interface IndexableSuggestion {
  id: string;
  docPath: string;
  description?: string | null;
  originalText: string;
  suggestedText: string;
  authorName: string;
  userId: string;
  status: string;
  createdAt: number;
}

interface IndexableDiscussion {
  id: string;
  docPath: string;
  title: string;
  description?: string | null;
  authorName: string;
  userId: string;
  status: string;
  createdAt: number;
}

interface IndexableDiscussionMessage {
  id: string;
  discussionId: string;
  content: string;
  authorName: string;
  userId: string;
  createdAt: number;
}

export class SearchIndexer {
  constructor(private db: Database) {}

  /**
   * Index a document for full-text search
   */
  async indexDocument(doc: IndexableDocument): Promise<void> {
    try {
      // First, remove any existing entry
      await this.db.$client
        .prepare(`DELETE FROM documents_fts WHERE doc_path = ?`)
        .bind(doc.docPath)
        .run();

      // Insert new entry
      await this.db.$client
        .prepare(`INSERT INTO documents_fts (doc_path, title, content, category)
         VALUES (?, ?, ?, ?)`)
        .bind(doc.docPath, doc.title, doc.content || '', doc.category || '')
        .run();
    } catch (error) {
      console.error('Failed to index document:', error);
      throw new Error(`Failed to index document: ${doc.docPath}`);
    }
  }

  /**
   * Index a comment for full-text search
   */
  async indexComment(comment: IndexableComment): Promise<void> {
    try {
      // Remove existing entry if updating
      await this.db.$client
        .prepare(`DELETE FROM comments_fts WHERE comment_id = ?`)
        .bind(comment.id)
        .run();

      // Insert new entry
      await this.db.$client
        .prepare(`INSERT INTO comments_fts (
          comment_id, doc_path, content, author_name, line_content,
          user_id, created_at, resolved
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          comment.id,
          comment.docPath,
          comment.content,
          comment.authorName,
          comment.lineContent || '',
          comment.userId,
          comment.createdAt,
          comment.resolved ? 1 : 0
        )
        .run();
    } catch (error) {
      console.error('Failed to index comment:', error);
      throw new Error(`Failed to index comment: ${comment.id}`);
    }
  }

  /**
   * Index a suggestion for full-text search
   */
  async indexSuggestion(suggestion: IndexableSuggestion): Promise<void> {
    try {
      // Remove existing entry if updating
      await this.db.$client
        .prepare(`DELETE FROM suggestions_fts WHERE suggestion_id = ?`)
        .bind(suggestion.id)
        .run();

      // Insert new entry
      await this.db.$client
        .prepare(`INSERT INTO suggestions_fts (
          suggestion_id, doc_path, description, original_text, suggested_text,
          author_name, user_id, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          suggestion.id,
          suggestion.docPath,
          suggestion.description || '',
          suggestion.originalText,
          suggestion.suggestedText,
          suggestion.authorName,
          suggestion.userId,
          suggestion.status,
          suggestion.createdAt
        )
        .run();
    } catch (error) {
      console.error('Failed to index suggestion:', error);
      throw new Error(`Failed to index suggestion: ${suggestion.id}`);
    }
  }

  /**
   * Index a discussion for full-text search
   */
  async indexDiscussion(discussion: IndexableDiscussion): Promise<void> {
    try {
      // Remove existing entry if updating
      await this.db.$client
        .prepare(`DELETE FROM discussions_fts WHERE discussion_id = ?`)
        .bind(discussion.id)
        .run();

      // Insert new entry
      await this.db.$client
        .prepare(`INSERT INTO discussions_fts (
          discussion_id, doc_path, title, description, author_name,
          user_id, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          discussion.id,
          discussion.docPath,
          discussion.title,
          discussion.description || '',
          discussion.authorName,
          discussion.userId,
          discussion.status,
          discussion.createdAt
        )
        .run();
    } catch (error) {
      console.error('Failed to index discussion:', error);
      throw new Error(`Failed to index discussion: ${discussion.id}`);
    }
  }

  /**
   * Index a discussion message for full-text search
   */
  async indexDiscussionMessage(message: IndexableDiscussionMessage): Promise<void> {
    try {
      // Remove existing entry if updating
      await this.db.$client
        .prepare(`DELETE FROM discussion_messages_fts WHERE message_id = ?`)
        .bind(message.id)
        .run();

      // Insert new entry
      await this.db.$client
        .prepare(`INSERT INTO discussion_messages_fts (
          message_id, discussion_id, content, author_name, user_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(
          message.id,
          message.discussionId,
          message.content,
          message.authorName,
          message.userId,
          message.createdAt
        )
        .run();
    } catch (error) {
      console.error('Failed to index discussion message:', error);
      throw new Error(`Failed to index discussion message: ${message.id}`);
    }
  }

  /**
   * Remove a comment from the search index
   */
  async removeComment(commentId: string): Promise<void> {
    await this.db.$client
      .prepare(`DELETE FROM comments_fts WHERE comment_id = ?`)
      .bind(commentId)
      .run();
  }

  /**
   * Remove a suggestion from the search index
   */
  async removeSuggestion(suggestionId: string): Promise<void> {
    await this.db.$client
      .prepare(`DELETE FROM suggestions_fts WHERE suggestion_id = ?`)
      .bind(suggestionId)
      .run();
  }

  /**
   * Remove a discussion from the search index
   */
  async removeDiscussion(discussionId: string): Promise<void> {
    await this.db.$client
      .prepare(`DELETE FROM discussions_fts WHERE discussion_id = ?`)
      .bind(discussionId)
      .run();
  }

  /**
   * Remove a discussion message from the search index
   */
  async removeDiscussionMessage(messageId: string): Promise<void> {
    await this.db.$client
      .prepare(`DELETE FROM discussion_messages_fts WHERE message_id = ?`)
      .bind(messageId)
      .run();
  }

  /**
   * Remove a document from the search index
   */
  async removeDocument(docPath: string): Promise<void> {
    await this.db.$client
      .prepare(`DELETE FROM documents_fts WHERE doc_path = ?`)
      .bind(docPath)
      .run();
  }

  /**
   * Batch index multiple comments
   */
  async batchIndexComments(comments: IndexableComment[]): Promise<void> {
    const stmt = this.db.$client.prepare(
      `INSERT INTO comments_fts (
        comment_id, doc_path, content, author_name, line_content,
        user_id, created_at, resolved
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const comment of comments) {
      // Remove existing entry first
      await this.db.$client
        .prepare(`DELETE FROM comments_fts WHERE comment_id = ?`)
        .bind(comment.id)
        .run();

      // Insert new entry
      await stmt
        .bind(
          comment.id,
          comment.docPath,
          comment.content,
          comment.authorName,
          comment.lineContent || '',
          comment.userId,
          comment.createdAt,
          comment.resolved ? 1 : 0
        )
        .run();
    }
  }

  /**
   * Re-index all content (maintenance operation)
   */
  async reindexAll(): Promise<{
    documents: number;
    comments: number;
    suggestions: number;
    discussions: number;
    messages: number;
  }> {
    const counts = {
      documents: 0,
      comments: 0,
      suggestions: 0,
      discussions: 0,
      messages: 0
    };

    try {
      // Clear all FTS tables
      await this.db.$client.prepare(`DELETE FROM documents_fts`).run();
      await this.db.$client.prepare(`DELETE FROM comments_fts`).run();
      await this.db.$client.prepare(`DELETE FROM suggestions_fts`).run();
      await this.db.$client.prepare(`DELETE FROM discussions_fts`).run();
      await this.db.$client.prepare(`DELETE FROM discussion_messages_fts`).run();

      // Re-index documents
      const documentsResult = await this.db.$client
        .prepare(`SELECT doc_path, title, description as content, category
         FROM document_metadata`)
        .all();
      const documents = documentsResult.results as any[];
      for (const doc of documents) {
        await this.indexDocument(doc);
        counts.documents++;
      }

      // Re-index comments with user names
      const commentsResult = await this.db.$client
        .prepare(`SELECT c.id, c.doc_path, c.content, u.name as author_name,
                c.user_id, c.line_content, c.resolved, c.created_at
         FROM comments c
         JOIN users u ON c.user_id = u.id
         WHERE c.deleted_at IS NULL`)
        .all();
      const comments = commentsResult.results as any[];
      for (const comment of comments) {
        await this.indexComment({
          ...comment,
          authorName: comment.author_name
        });
        counts.comments++;
      }

      // Re-index suggestions with user names
      const suggestionsResult = await this.db.$client
        .prepare(`SELECT s.id, s.doc_path, s.description, s.original_text,
                s.suggested_text, u.name as author_name, s.user_id,
                s.status, s.created_at
         FROM suggestions s
         JOIN users u ON s.user_id = u.id
         WHERE s.deleted_at IS NULL`)
        .all();
      const suggestions = suggestionsResult.results as any[];
      for (const suggestion of suggestions) {
        await this.indexSuggestion({
          ...suggestion,
          authorName: suggestion.author_name
        });
        counts.suggestions++;
      }

      // Re-index discussions with user names
      const discussionsResult = await this.db.$client
        .prepare(`SELECT d.id, d.doc_path, d.title, d.description, u.name as author_name,
                d.user_id, d.status, d.created_at
         FROM discussions d
         JOIN users u ON d.user_id = u.id
         WHERE d.deleted_at IS NULL`)
        .all();
      const discussions = discussionsResult.results as any[];
      for (const discussion of discussions) {
        await this.indexDiscussion({
          ...discussion,
          authorName: discussion.author_name
        });
        counts.discussions++;
      }

      // Re-index discussion messages with user names
      const messagesResult = await this.db.$client
        .prepare(`SELECT dm.id, dm.discussion_id, dm.content, u.name as author_name,
                dm.user_id, dm.created_at
         FROM discussion_messages dm
         JOIN users u ON dm.user_id = u.id
         WHERE dm.deleted_at IS NULL`)
        .all();
      const messages = messagesResult.results as any[];
      for (const message of messages) {
        await this.indexDiscussionMessage({
          ...message,
          authorName: message.author_name
        });
        counts.messages++;
      }

      return counts;
    } catch (error) {
      console.error('Failed to reindex all content:', error);
      throw new Error('Failed to reindex search content');
    }
  }

  /**
   * Get index statistics
   */
  async getIndexStats(): Promise<{
    documents: number;
    comments: number;
    suggestions: number;
    discussions: number;
    messages: number;
    totalSize: number;
  }> {
    const [docsResult, commentsResult, suggestionsResult, discussionsResult, messagesResult] = await Promise.all([
      this.db.$client.prepare(`SELECT COUNT(*) as count FROM documents_fts`).first(),
      this.db.$client.prepare(`SELECT COUNT(*) as count FROM comments_fts`).first(),
      this.db.$client.prepare(`SELECT COUNT(*) as count FROM suggestions_fts`).first(),
      this.db.$client.prepare(`SELECT COUNT(*) as count FROM discussions_fts`).first(),
      this.db.$client.prepare(`SELECT COUNT(*) as count FROM discussion_messages_fts`).first()
    ]);

    const docs = docsResult as { count: number } | null;
    const comments = commentsResult as { count: number } | null;
    const suggestions = suggestionsResult as { count: number } | null;
    const discussions = discussionsResult as { count: number } | null;
    const messages = messagesResult as { count: number } | null;

    const totalSize =
      (docs?.count || 0) +
      (comments?.count || 0) +
      (suggestions?.count || 0) +
      (discussions?.count || 0) +
      (messages?.count || 0);

    return {
      documents: docs?.count || 0,
      comments: comments?.count || 0,
      suggestions: suggestions?.count || 0,
      discussions: discussions?.count || 0,
      messages: messages?.count || 0,
      totalSize
    };
  }
}
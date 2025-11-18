/**
 * Webhook Storage Layer
 *
 * Handles persistence and retrieval of webhook events for audit trail
 */

import { nanoid } from 'nanoid';
import type {
  WebhookEvent,
  WebhookConfiguration,
  WebhookDelivery,
  WebhookProvider,
  WebhookDeliveryStatus,
  WebhookStats
} from './types';

export class WebhookStorage {
  constructor(private db: D1Database) {}

  // ============================================================================
  // Webhook Events
  // ============================================================================

  /**
   * Store a new webhook event
   */
  async createWebhookEvent(params: {
    provider: WebhookProvider;
    eventType: string;
    eventAction?: string;
    payload: unknown;
    signature?: string;
    headers?: Record<string, string>;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<WebhookEvent> {
    const id = nanoid();
    const now = Date.now();

    // Extract metadata from payload
    const metadata = this.extractMetadata(params.provider, params.eventType, params.payload);

    const event: WebhookEvent = {
      id,
      provider: params.provider,
      eventType: params.eventType,
      eventAction: params.eventAction,
      payload: JSON.stringify(params.payload),
      signature: params.signature,
      headers: params.headers ? JSON.stringify(params.headers) : undefined,
      processed: 0,
      processedAt: undefined,
      error: undefined,
      retryCount: 0,
      prNumber: metadata.prNumber,
      branch: metadata.branch,
      repository: metadata.repository,
      senderUsername: metadata.senderUsername,
      createdAt: now,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent
    };

    await this.db
      .prepare(`
        INSERT INTO webhook_events (
          id, provider, event_type, event_action, payload, signature, headers,
          processed, retry_count, pr_number, branch, repository, sender_username,
          created_at, ip_address, user_agent
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        event.id,
        event.provider,
        event.eventType,
        event.eventAction,
        event.payload,
        event.signature,
        event.headers,
        event.processed,
        event.retryCount,
        event.prNumber,
        event.branch,
        event.repository,
        event.senderUsername,
        event.createdAt,
        event.ipAddress,
        event.userAgent
      )
      .run();

    return event;
  }

  /**
   * Get a webhook event by ID
   */
  async getWebhookEvent(id: string): Promise<WebhookEvent | null> {
    const result = await this.db
      .prepare('SELECT * FROM webhook_events WHERE id = ?')
      .bind(id)
      .first<WebhookEvent>();

    return result || null;
  }

  /**
   * List webhook events with filtering
   */
  async listWebhookEvents(params?: {
    provider?: WebhookProvider;
    eventType?: string;
    processed?: boolean;
    prNumber?: number;
    branch?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ events: WebhookEvent[]; total: number }> {
    let query = 'SELECT * FROM webhook_events WHERE 1=1';
    let countQuery = 'SELECT COUNT(*) as total FROM webhook_events WHERE 1=1';
    const bindings: unknown[] = [];
    const countBindings: unknown[] = [];

    if (params?.provider) {
      query += ' AND provider = ?';
      countQuery += ' AND provider = ?';
      bindings.push(params.provider);
      countBindings.push(params.provider);
    }

    if (params?.eventType) {
      query += ' AND event_type = ?';
      countQuery += ' AND event_type = ?';
      bindings.push(params.eventType);
      countBindings.push(params.eventType);
    }

    if (params?.processed !== undefined) {
      const processedValue = params.processed ? 1 : 0;
      query += ' AND processed = ?';
      countQuery += ' AND processed = ?';
      bindings.push(processedValue);
      countBindings.push(processedValue);
    }

    if (params?.prNumber) {
      query += ' AND pr_number = ?';
      countQuery += ' AND pr_number = ?';
      bindings.push(params.prNumber);
      countBindings.push(params.prNumber);
    }

    if (params?.branch) {
      query += ' AND branch = ?';
      countQuery += ' AND branch = ?';
      bindings.push(params.branch);
      countBindings.push(params.branch);
    }

    query += ' ORDER BY created_at DESC';

    const limit = params?.limit || 50;
    const offset = params?.offset || 0;
    query += ' LIMIT ? OFFSET ?';
    bindings.push(limit, offset);

    const [events, countResult] = await Promise.all([
      this.db.prepare(query).bind(...bindings).all<WebhookEvent>(),
      this.db.prepare(countQuery).bind(...countBindings).first<{ total: number }>()
    ]);

    return {
      events: events.results || [],
      total: countResult?.total || 0
    };
  }

  /**
   * Mark a webhook event as processed
   */
  async markWebhookEventProcessed(id: string, error?: string): Promise<void> {
    const processed = error ? -1 : 1; // -1 for failed, 1 for success
    const now = Date.now();

    await this.db
      .prepare(`
        UPDATE webhook_events
        SET processed = ?, processed_at = ?, error = ?
        WHERE id = ?
      `)
      .bind(processed, now, error, id)
      .run();
  }

  /**
   * Increment retry count for a webhook event
   */
  async incrementRetryCount(id: string): Promise<void> {
    await this.db
      .prepare('UPDATE webhook_events SET retry_count = retry_count + 1 WHERE id = ?')
      .bind(id)
      .run();
  }

  /**
   * Get unprocessed webhook events for processing
   */
  async getUnprocessedEvents(limit: number = 10): Promise<WebhookEvent[]> {
    const results = await this.db
      .prepare(`
        SELECT * FROM webhook_events
        WHERE processed = 0 AND retry_count < 5
        ORDER BY created_at ASC
        LIMIT ?
      `)
      .bind(limit)
      .all<WebhookEvent>();

    return results.results || [];
  }

  // ============================================================================
  // Webhook Configurations
  // ============================================================================

  /**
   * Get webhook configuration for a provider
   */
  async getWebhookConfig(provider: WebhookProvider): Promise<WebhookConfiguration | null> {
    const result = await this.db
      .prepare('SELECT * FROM webhook_configurations WHERE provider = ?')
      .bind(provider)
      .first<WebhookConfiguration>();

    return result || null;
  }

  /**
   * Create or update webhook configuration
   */
  async upsertWebhookConfig(params: {
    provider: WebhookProvider;
    webhookUrl: string;
    secret: string;
    events: string[];
    active?: boolean;
  }): Promise<WebhookConfiguration> {
    const id = nanoid();
    const now = Date.now();

    const config: WebhookConfiguration = {
      id,
      provider: params.provider,
      webhookUrl: params.webhookUrl,
      secret: params.secret, // Should be encrypted before storing
      events: JSON.stringify(params.events),
      active: params.active !== false ? 1 : 0,
      failureCount: 0,
      createdAt: now,
      updatedAt: now
    };

    await this.db
      .prepare(`
        INSERT INTO webhook_configurations (
          id, provider, webhook_url, secret, events, active,
          failure_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(provider) DO UPDATE SET
          webhook_url = excluded.webhook_url,
          secret = excluded.secret,
          events = excluded.events,
          active = excluded.active,
          updated_at = excluded.updated_at
      `)
      .bind(
        config.id,
        config.provider,
        config.webhookUrl,
        config.secret,
        config.events,
        config.active,
        config.failureCount,
        config.createdAt,
        config.updatedAt
      )
      .run();

    return config;
  }

  /**
   * Update last delivery status for a webhook configuration
   */
  async updateLastDelivery(
    provider: WebhookProvider,
    status: string,
    success: boolean
  ): Promise<void> {
    const now = Date.now();

    if (success) {
      await this.db
        .prepare(`
          UPDATE webhook_configurations
          SET last_delivery_at = ?, last_delivery_status = ?, failure_count = 0
          WHERE provider = ?
        `)
        .bind(now, status, provider)
        .run();
    } else {
      await this.db
        .prepare(`
          UPDATE webhook_configurations
          SET last_delivery_at = ?, last_delivery_status = ?,
              failure_count = failure_count + 1
          WHERE provider = ?
        `)
        .bind(now, status, provider)
        .run();
    }
  }

  // ============================================================================
  // Webhook Deliveries
  // ============================================================================

  /**
   * Create a webhook delivery record
   */
  async createDelivery(params: {
    eventId: string;
    status: WebhookDeliveryStatus;
    responseStatus?: number;
    responseBody?: string;
    durationMs?: number;
    attemptNumber?: number;
  }): Promise<WebhookDelivery> {
    const id = nanoid();
    const now = Date.now();

    const delivery: WebhookDelivery = {
      id,
      eventId: params.eventId,
      status: params.status,
      responseStatus: params.responseStatus,
      responseBody: params.responseBody,
      durationMs: params.durationMs,
      attemptNumber: params.attemptNumber || 1,
      createdAt: now
    };

    await this.db
      .prepare(`
        INSERT INTO webhook_deliveries (
          id, event_id, status, response_status, response_body,
          duration_ms, attempt_number, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        delivery.id,
        delivery.eventId,
        delivery.status,
        delivery.responseStatus,
        delivery.responseBody,
        delivery.durationMs,
        delivery.attemptNumber,
        delivery.createdAt
      )
      .run();

    return delivery;
  }

  /**
   * Get deliveries for a webhook event
   */
  async getDeliveriesForEvent(eventId: string): Promise<WebhookDelivery[]> {
    const results = await this.db
      .prepare(`
        SELECT * FROM webhook_deliveries
        WHERE event_id = ?
        ORDER BY created_at DESC
      `)
      .bind(eventId)
      .all<WebhookDelivery>();

    return results.results || [];
  }

  // ============================================================================
  // Statistics and Analytics
  // ============================================================================

  /**
   * Get webhook statistics by provider
   */
  async getWebhookStats(provider?: WebhookProvider): Promise<WebhookStats[]> {
    let query = `
      SELECT
        provider,
        COUNT(*) as total,
        SUM(CASE WHEN processed = 1 THEN 1 ELSE 0 END) as processed,
        SUM(CASE WHEN processed = -1 THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN processed = 0 THEN 1 ELSE 0 END) as pending,
        MAX(created_at) as last_received,
        MAX(CASE WHEN processed = 1 THEN processed_at ELSE NULL END) as last_processed
      FROM webhook_events
    `;

    const bindings: unknown[] = [];

    if (provider) {
      query += ' WHERE provider = ?';
      bindings.push(provider);
    }

    query += ' GROUP BY provider';

    const results = await this.db
      .prepare(query)
      .bind(...bindings)
      .all<{
        provider: WebhookProvider;
        total: number;
        processed: number;
        failed: number;
        pending: number;
        last_received: number | null;
        last_processed: number | null;
      }>();

    return (results.results || []).map(row => ({
      provider: row.provider,
      total: row.total,
      processed: row.processed,
      failed: row.failed,
      pending: row.pending,
      lastReceived: row.last_received ? new Date(row.last_received).toISOString() : undefined,
      lastProcessed: row.last_processed ? new Date(row.last_processed).toISOString() : undefined
    }));
  }

  /**
   * Clean up old webhook events (retention policy)
   */
  async cleanupOldEvents(daysToKeep: number = 30): Promise<number> {
    const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);

    const result = await this.db
      .prepare('DELETE FROM webhook_events WHERE created_at < ? AND processed = 1')
      .bind(cutoffTime)
      .run();

    return result.meta.changes || 0;
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Extract metadata from webhook payload
   */
  private extractMetadata(
    provider: WebhookProvider,
    eventType: string,
    payload: unknown
  ): {
    prNumber?: number;
    branch?: string;
    repository?: string;
    senderUsername?: string;
  } {
    const metadata: {
      prNumber?: number;
      branch?: string;
      repository?: string;
      senderUsername?: string;
    } = {};

    try {
      if (provider === 'github') {
        const githubPayload = payload as any;

        // Extract PR number
        if (githubPayload.pull_request) {
          metadata.prNumber = githubPayload.pull_request.number;
          metadata.branch = githubPayload.pull_request.head?.ref;
        } else if (githubPayload.issue?.pull_request) {
          metadata.prNumber = githubPayload.issue.number;
        }

        // Extract repository
        if (githubPayload.repository) {
          metadata.repository = githubPayload.repository.full_name;
        }

        // Extract sender
        if (githubPayload.sender) {
          metadata.senderUsername = githubPayload.sender.login;
        }

        // Extract branch from push events
        if (eventType === 'push' && githubPayload.ref) {
          metadata.branch = githubPayload.ref.replace('refs/heads/', '');
        }
      } else if (provider === 'gitlab') {
        const gitlabPayload = payload as any;

        // Extract MR number
        if (gitlabPayload.object_attributes?.iid) {
          metadata.prNumber = gitlabPayload.object_attributes.iid;
        } else if (gitlabPayload.merge_request?.iid) {
          metadata.prNumber = gitlabPayload.merge_request.iid;
        }

        // Extract branch
        if (gitlabPayload.object_attributes?.source_branch) {
          metadata.branch = gitlabPayload.object_attributes.source_branch;
        } else if (gitlabPayload.ref) {
          metadata.branch = gitlabPayload.ref.replace('refs/heads/', '');
        }

        // Extract repository
        if (gitlabPayload.project?.path_with_namespace) {
          metadata.repository = gitlabPayload.project.path_with_namespace;
        }

        // Extract sender
        if (gitlabPayload.user?.username) {
          metadata.senderUsername = gitlabPayload.user.username;
        } else if (gitlabPayload.user_username) {
          metadata.senderUsername = gitlabPayload.user_username;
        }
      }
    } catch (error) {
      console.error('Error extracting metadata from webhook payload:', error);
    }

    return metadata;
  }
}
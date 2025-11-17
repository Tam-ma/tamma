/**
 * Webhook Integration Tests
 *
 * Tests for GitHub and GitLab webhook receivers
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock React Router's json utility
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return {
    ...actual,
    json: (data: any, init?: ResponseInit) => {
      return new Response(JSON.stringify(data), {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...(init?.headers || {})
        }
      });
    }
  };
});

import { action as githubAction } from './webhooks.github';
import { action as gitlabAction } from './webhooks.gitlab';

// Mock crypto for signature verification
const mockCrypto = {
  subtle: {
    importKey: vi.fn(),
    sign: vi.fn()
  }
};

// Mock environment
const createMockEnv = () => ({
  DB: {
    prepare: vi.fn().mockReturnThis(),
    bind: vi.fn().mockReturnThis(),
    run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
    first: vi.fn().mockResolvedValue(null),
    all: vi.fn().mockResolvedValue({ results: [] })
  },
  CACHE: {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined)
  },
  GITHUB_WEBHOOK_SECRET: 'test-github-secret',
  GITLAB_WEBHOOK_TOKEN: 'test-gitlab-token'
});

// Helper to create mock request
const createMockRequest = (
  method: string,
  headers: Record<string, string>,
  body?: string
) => ({
  method,
  headers: new Headers(headers),
  text: vi.fn().mockResolvedValue(body || '{}'),
  url: 'https://example.com/webhooks/github'
});

// Helper to create GitHub signature
async function createGitHubSignature(payload: string, secret: string): Promise<string> {
  // Simplified signature for testing
  return `sha256=${Buffer.from(payload + secret).toString('base64')}`;
}

describe('GitHub Webhook Receiver', () => {
  let mockEnv: ReturnType<typeof createMockEnv>;
  let mockContext: any;

  beforeEach(() => {
    mockEnv = createMockEnv();
    mockContext = {
      cloudflare: {
        env: mockEnv,
        ctx: {
          waitUntil: vi.fn()
        }
      }
    };

    // Mock global crypto using Object.defineProperty
    Object.defineProperty(global, 'crypto', {
      value: mockCrypto,
      writable: true,
      configurable: true
    });
    mockCrypto.subtle.importKey.mockResolvedValue({});
    mockCrypto.subtle.sign.mockResolvedValue(new ArrayBuffer(32));
  });

  it('should reject requests without GitHub headers', async () => {
    const request = createMockRequest('POST', {
      'Content-Type': 'application/json'
    });

    const response = await githubAction({
      request,
      context: mockContext,
      params: {}
    } as any);

    const data = await response.json();
    expect(response.status).toBe(400);
    expect(data.error).toContain('Missing required GitHub headers');
  });

  it('should accept valid pull_request event', async () => {
    const payload = JSON.stringify({
      action: 'opened',
      number: 123,
      pull_request: {
        number: 123,
        title: 'Test PR',
        state: 'open',
        draft: false,
        user: { id: 1, login: 'testuser' },
        head: { ref: 'feature-branch', sha: 'abc123' },
        base: { ref: 'main', sha: 'def456' },
        html_url: 'https://github.com/test/repo/pull/123',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      repository: { full_name: 'test/repo' },
      sender: { login: 'testuser' }
    });

    const request = createMockRequest('POST', {
      'Content-Type': 'application/json',
      'X-GitHub-Event': 'pull_request',
      'X-GitHub-Delivery': 'test-delivery-123'
    }, payload);

    // Disable signature verification for this test
    mockEnv.GITHUB_WEBHOOK_SECRET = undefined;

    const response = await githubAction({
      request,
      context: mockContext,
      params: {}
    } as any);

    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.message).toBe('Webhook received');
    expect(data.eventType).toBe('pull_request');
  });

  it('should reject invalid signature', async () => {
    const payload = JSON.stringify({ test: 'data' });

    const request = createMockRequest('POST', {
      'Content-Type': 'application/json',
      'X-GitHub-Event': 'pull_request',
      'X-GitHub-Delivery': 'test-delivery-123',
      'X-Hub-Signature-256': 'sha256=invalid'
    }, payload);

    const response = await githubAction({
      request,
      context: mockContext,
      params: {}
    } as any);

    const data = await response.json();
    expect(response.status).toBe(401);
    expect(data.error).toContain('Invalid webhook signature');
  });

  it('should ignore unsupported events', async () => {
    const request = createMockRequest('POST', {
      'Content-Type': 'application/json',
      'X-GitHub-Event': 'star',
      'X-GitHub-Delivery': 'test-delivery-123'
    });

    const response = await githubAction({
      request,
      context: mockContext,
      params: {}
    } as any);

    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.message).toContain('not supported');
  });

  it('should handle pull_request_review event', async () => {
    const payload = JSON.stringify({
      action: 'submitted',
      review: {
        id: 456,
        state: 'APPROVED',
        body: 'LGTM',
        user: { id: 2, login: 'reviewer' },
        submitted_at: new Date().toISOString()
      },
      pull_request: {
        number: 123,
        title: 'Test PR'
      },
      repository: { full_name: 'test/repo' },
      sender: { login: 'reviewer' }
    });

    const request = createMockRequest('POST', {
      'Content-Type': 'application/json',
      'X-GitHub-Event': 'pull_request_review',
      'X-GitHub-Delivery': 'test-delivery-456',
      'X-Hub-Signature-256': 'sha256=test'
    }, payload);

    // Disable signature verification for this test
    mockEnv.GITHUB_WEBHOOK_SECRET = undefined;

    const response = await githubAction({
      request,
      context: mockContext,
      params: {}
    } as any);

    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.eventType).toBe('pull_request_review');
  });

  it('should handle issue_comment event on PR', async () => {
    const payload = JSON.stringify({
      action: 'created',
      comment: {
        id: 789,
        body: 'Test comment',
        user: { id: 3, login: 'commenter' },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      issue: {
        number: 123,
        title: 'Test PR',
        pull_request: { url: 'https://api.github.com/repos/test/repo/pulls/123' }
      },
      repository: { full_name: 'test/repo' },
      sender: { login: 'commenter' }
    });

    const request = createMockRequest('POST', {
      'Content-Type': 'application/json',
      'X-GitHub-Event': 'issue_comment',
      'X-GitHub-Delivery': 'test-delivery-789'
    }, payload);

    mockEnv.GITHUB_WEBHOOK_SECRET = undefined;

    const response = await githubAction({
      request,
      context: mockContext,
      params: {}
    } as any);

    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.eventType).toBe('issue_comment');
  });

  it('should enforce rate limiting', async () => {
    // Mock rate limit exceeded
    mockEnv.CACHE.get.mockResolvedValue({
      count: 100,
      windowStart: Math.floor(Date.now() / 1000) - 30
    });

    const request = createMockRequest('POST', {
      'Content-Type': 'application/json',
      'X-GitHub-Event': 'pull_request',
      'X-GitHub-Delivery': 'test-delivery-999'
    });

    const response = await githubAction({
      request,
      context: mockContext,
      params: {}
    } as any);

    const data = await response.json();
    expect(response.status).toBe(429);
    expect(data.error).toContain('Rate limit exceeded');
  });
});

describe('GitLab Webhook Receiver', () => {
  let mockEnv: ReturnType<typeof createMockEnv>;
  let mockContext: any;

  beforeEach(() => {
    mockEnv = createMockEnv();
    mockContext = {
      cloudflare: {
        env: mockEnv,
        ctx: {
          waitUntil: vi.fn()
        }
      }
    };
  });

  it('should reject requests without GitLab headers', async () => {
    const request = createMockRequest('POST', {
      'Content-Type': 'application/json'
    });

    const response = await gitlabAction({
      request,
      context: mockContext,
      params: {}
    } as any);

    const data = await response.json();
    expect(response.status).toBe(400);
    expect(data.error).toContain('Missing required GitLab headers');
  });

  it('should accept valid merge_request event', async () => {
    const payload = JSON.stringify({
      object_kind: 'merge_request',
      event_type: 'merge_request',
      user: { id: 1, username: 'testuser' },
      project: {
        id: 1,
        path_with_namespace: 'test/repo'
      },
      object_attributes: {
        iid: 123,
        title: 'Test MR',
        state: 'opened',
        action: 'open',
        source_branch: 'feature-branch',
        target_branch: 'main',
        web_url: 'https://gitlab.com/test/repo/-/merge_requests/123',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    });

    const request = createMockRequest('POST', {
      'Content-Type': 'application/json',
      'X-Gitlab-Event': 'Merge Request Hook',
      'X-Gitlab-Token': 'test-gitlab-token'
    }, payload);

    const response = await gitlabAction({
      request,
      context: mockContext,
      params: {}
    } as any);

    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.message).toBe('Webhook received');
    expect(data.eventType).toBe('merge_request');
  });

  it('should reject invalid token', async () => {
    const payload = JSON.stringify({ test: 'data' });

    const request = createMockRequest('POST', {
      'Content-Type': 'application/json',
      'X-Gitlab-Event': 'Merge Request Hook',
      'X-Gitlab-Token': 'wrong-token'
    }, payload);

    const response = await gitlabAction({
      request,
      context: mockContext,
      params: {}
    } as any);

    const data = await response.json();
    expect(response.status).toBe(401);
    expect(data.error).toContain('Invalid webhook token');
  });

  it('should handle note event', async () => {
    const payload = JSON.stringify({
      object_kind: 'note',
      event_type: 'note',
      user: { id: 2, username: 'reviewer' },
      project: {
        id: 1,
        path_with_namespace: 'test/repo'
      },
      object_attributes: {
        id: 456,
        note: 'Test comment',
        noteable_type: 'MergeRequest',
        noteable_id: 123,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      merge_request: {
        iid: 123
      }
    });

    const request = createMockRequest('POST', {
      'Content-Type': 'application/json',
      'X-Gitlab-Event': 'Note Hook',
      'X-Gitlab-Token': 'test-gitlab-token'
    }, payload);

    const response = await gitlabAction({
      request,
      context: mockContext,
      params: {}
    } as any);

    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.eventType).toBe('note');
  });

  it('should handle push event', async () => {
    const payload = JSON.stringify({
      object_kind: 'push',
      event_name: 'push',
      ref: 'refs/heads/main',
      before: 'abc123',
      after: 'def456',
      commits: [
        {
          id: 'def456',
          message: 'Test commit',
          author: { name: 'Test User', email: 'test@example.com' },
          timestamp: new Date().toISOString(),
          added: ['file1.md'],
          modified: ['file2.md'],
          removed: []
        }
      ],
      project: {
        id: 1,
        path_with_namespace: 'test/repo'
      },
      user_username: 'testuser'
    });

    const request = createMockRequest('POST', {
      'Content-Type': 'application/json',
      'X-Gitlab-Event': 'Push Hook'
    }, payload);

    // Disable token verification for this test
    mockEnv.GITLAB_WEBHOOK_TOKEN = undefined;

    const response = await gitlabAction({
      request,
      context: mockContext,
      params: {}
    } as any);

    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.eventType).toBe('push');
  });

  it('should handle invalid JSON payload', async () => {
    const request = createMockRequest('POST', {
      'Content-Type': 'application/json',
      'X-Gitlab-Event': 'Merge Request Hook'
    }, 'invalid-json');

    mockEnv.GITLAB_WEBHOOK_TOKEN = undefined;

    const response = await gitlabAction({
      request,
      context: mockContext,
      params: {}
    } as any);

    const data = await response.json();
    expect(response.status).toBe(400);
    expect(data.error).toContain('Invalid JSON payload');
  });

  it('should map GitLab event names correctly', async () => {
    const eventMappings = [
      { header: 'Merge Request Hook', expected: 'merge_request' },
      { header: 'Note Hook', expected: 'note' },
      { header: 'Push Hook', expected: 'push' }
    ];

    for (const mapping of eventMappings) {
      const payload = JSON.stringify({
        object_kind: mapping.expected,
        test: 'data'
      });

      const request = createMockRequest('POST', {
        'Content-Type': 'application/json',
        'X-Gitlab-Event': mapping.header
      }, payload);

      mockEnv.GITLAB_WEBHOOK_TOKEN = undefined;

      const response = await gitlabAction({
        request,
        context: mockContext,
        params: {}
      } as any);

      const data = await response.json();
      expect(data.eventType).toBe(mapping.expected);
    }
  });
});

describe('Webhook Storage', () => {
  it('should store webhook events with metadata extraction', async () => {
    const { WebhookStorage } = await import('~/lib/webhooks/storage.server');
    const mockDB = createMockEnv().DB;
    const storage = new WebhookStorage(mockDB as any);

    const event = await storage.createWebhookEvent({
      provider: 'github',
      eventType: 'pull_request',
      eventAction: 'opened',
      payload: {
        pull_request: { number: 123 },
        repository: { full_name: 'test/repo' },
        sender: { login: 'testuser' }
      },
      signature: 'test-signature',
      headers: { 'X-GitHub-Event': 'pull_request' }
    });

    expect(event.provider).toBe('github');
    expect(event.eventType).toBe('pull_request');
    expect(event.prNumber).toBe(123);
    expect(event.repository).toBe('test/repo');
    expect(event.senderUsername).toBe('testuser');
  });

  it('should retrieve webhook statistics', async () => {
    const { WebhookStorage } = await import('~/lib/webhooks/storage.server');
    const mockDB = createMockEnv().DB;

    mockDB.prepare().all.mockResolvedValue({
      results: [
        {
          provider: 'github',
          total: 100,
          processed: 85,
          failed: 5,
          pending: 10,
          last_received: Date.now(),
          last_processed: Date.now() - 1000
        }
      ]
    });

    const storage = new WebhookStorage(mockDB as any);
    const stats = await storage.getWebhookStats('github');

    expect(stats).toHaveLength(1);
    expect(stats[0].provider).toBe('github');
    expect(stats[0].total).toBe(100);
    expect(stats[0].processed).toBe(85);
  });
});

describe('Webhook Processor', () => {
  it('should process GitHub pull_request event', async () => {
    const { WebhookProcessor } = await import('~/lib/webhooks/processor.server');
    const mockDB = createMockEnv().DB;
    const mockStorage = {
      markWebhookEventProcessed: vi.fn()
    };

    const processor = new WebhookProcessor(mockDB as any, mockStorage as any);

    const result = await processor.processWebhookEvent(
      'test-event-id',
      'github',
      'pull_request',
      {
        action: 'opened',
        number: 123,
        pull_request: {
          number: 123,
          title: 'Test PR',
          state: 'open',
          draft: false,
          user: { id: 1, login: 'testuser' },
          head: { ref: 'feature-branch' },
          base: { ref: 'main' },
          html_url: 'https://github.com/test/repo/pull/123',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        },
        repository: { full_name: 'test/repo' },
        sender: { login: 'testuser' }
      }
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain('Processed pull_request.opened event');
    expect(mockStorage.markWebhookEventProcessed).toHaveBeenCalledWith('test-event-id');
  });

  it('should handle unsupported events gracefully', async () => {
    const { WebhookProcessor } = await import('~/lib/webhooks/processor.server');
    const mockDB = createMockEnv().DB;
    const mockStorage = {
      markWebhookEventProcessed: vi.fn()
    };

    const processor = new WebhookProcessor(mockDB as any, mockStorage as any);

    const result = await processor.processWebhookEvent(
      'test-event-id',
      'github',
      'star',
      { action: 'created' }
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unsupported event type');
  });
});
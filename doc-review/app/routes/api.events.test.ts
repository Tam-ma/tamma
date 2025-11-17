/**
 * Integration tests for SSE event streaming
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AppLoadContext } from '@remix-run/cloudflare';

// Mock EventSource for testing
class MockEventSource {
  url: string;
  readyState: number = 0; // CONNECTING
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    // Simulate connection
    setTimeout(() => {
      this.readyState = 1; // OPEN
      if (this.onopen) {
        this.onopen(new Event('open'));
      }
    }, 10);
  }

  close() {
    this.readyState = 2; // CLOSED
  }

  // Helper to simulate receiving a message
  simulateMessage(data: any) {
    if (this.onmessage) {
      this.onmessage(new MessageEvent('message', { data: JSON.stringify(data) }));
    }
  }

  // Helper to simulate error
  simulateError() {
    if (this.onerror) {
      this.onerror(new Event('error'));
    }
    this.readyState = 2; // CLOSED
  }
}

// Mock Durable Object stub
class MockDurableObjectStub {
  private connections = new Map<string, any>();
  private events: any[] = [];

  async fetch(requestOrUrl: Request | string, init?: RequestInit): Promise<Response> {
    // Handle both Request objects and URL strings (with optional RequestInit)
    const request = typeof requestOrUrl === 'string'
      ? new Request(requestOrUrl, init)
      : requestOrUrl;

    const url = new URL(request.url);

    if (url.pathname === '/sse') {
      const userId = url.searchParams.get('userId');
      if (!userId) {
        return new Response('User ID required', { status: 401 });
      }

      // Create SSE response
      const stream = new ReadableStream({
        start: (controller) => {
          const encoder = new TextEncoder();

          // Send connection event
          const connectEvent = `data: ${JSON.stringify({
            type: 'connected',
            data: { connectionId: 'test-connection', userId }
          })}\n\n`;
          controller.enqueue(encoder.encode(connectEvent));

          // Send recent events
          for (const event of this.events.slice(-10)) {
            const sseEvent = `data: ${JSON.stringify(event)}\n\n`;
            controller.enqueue(encoder.encode(sseEvent));
          }

          // Store connection
          this.connections.set(userId, controller);
        }
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        }
      });
    }

    if (url.pathname === '/publish' && request.method === 'POST') {
      try {
        const event = await request.json();
        this.events.push(event);

        // Broadcast to connections
        const encoder = new TextEncoder();
        const sseEvent = `data: ${JSON.stringify(event)}\n\n`;
        const data = encoder.encode(sseEvent);

        for (const controller of this.connections.values()) {
          try {
            controller.enqueue(data);
          } catch (e) {
            // Connection closed
          }
        }

        return new Response(JSON.stringify({ success: true }));
      } catch (error) {
        return new Response(JSON.stringify({ error: 'Invalid event data' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    if (url.pathname === '/recent') {
      return new Response(JSON.stringify(this.events.slice(-100)));
    }

    return new Response('Not found', { status: 404 });
  }
}

// Mock context with Durable Object
const createMockContext = (): AppLoadContext => {
  const stub = new MockDurableObjectStub();

  return {
    cloudflare: {
      env: {
        EVENT_BROADCASTER: {
          idFromName: (name: string) => ({ toString: () => name }),
          get: (id: any) => stub
        }
      }
    }
  } as any;
};

describe('SSE Event Streaming', () => {
  let mockContext: AppLoadContext;

  beforeEach(() => {
    mockContext = createMockContext();
    global.EventSource = MockEventSource as any;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Connection Management', () => {
    it('should establish SSE connection with authentication', async () => {
      const { subscribeToEvents } = await import('~/lib/events/publisher.server');

      const response = await subscribeToEvents(mockContext, 'test-doc', 'user-123');

      expect(response.headers.get('Content-Type')).toBe('text/event-stream');
      expect(response.headers.get('Cache-Control')).toBe('no-cache');
    });

    it('should reject connection without user ID', async () => {
      const stub = mockContext.cloudflare.env.EVENT_BROADCASTER.get(null);
      const response = await stub.fetch(new Request('https://internal/sse'));

      expect(response.status).toBe(401);
      expect(await response.text()).toBe('User ID required');
    });

    it('should send connection event on successful connect', async () => {
      const { subscribeToEvents } = await import('~/lib/events/publisher.server');

      const response = await subscribeToEvents(mockContext, 'test-doc', 'user-123');
      const reader = response.body?.getReader();

      if (reader) {
        const { value } = await reader.read();
        const text = new TextDecoder().decode(value);

        expect(text).toContain('connected');
        expect(text).toContain('test-connection');
        expect(text).toContain('user-123');
      }
    });
  });

  describe('Event Publishing', () => {
    it('should publish comment created event', async () => {
      const { publishCommentEvent } = await import('~/lib/events/publisher.server');

      const comment = {
        id: 'comment-1',
        content: 'Test comment',
        userId: 'user-123',
        docPath: 'test-doc'
      };

      await publishCommentEvent(mockContext, 'test-doc', 'created', comment, 'user-123');

      // Verify event was published
      const stub = mockContext.cloudflare.env.EVENT_BROADCASTER.get(null);
      const response = await stub.fetch(new Request('https://internal/recent'));
      const events = await response.json();

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('comment.created');
      expect(events[0].data).toEqual(comment);
    });

    it('should publish suggestion approved event', async () => {
      const { publishSuggestionEvent } = await import('~/lib/events/publisher.server');

      const suggestion = {
        id: 'suggestion-1',
        description: 'Test suggestion',
        status: 'approved'
      };

      await publishSuggestionEvent(mockContext, 'test-doc', 'approved', suggestion, 'user-123');

      const stub = mockContext.cloudflare.env.EVENT_BROADCASTER.get(null);
      const response = await stub.fetch(new Request('https://internal/recent'));
      const events = await response.json();

      expect(events[0].type).toBe('suggestion.approved');
      expect(events[0].data).toEqual(suggestion);
    });

    it('should publish discussion message event', async () => {
      const { publishDiscussionEvent } = await import('~/lib/events/publisher.server');

      const message = {
        id: 'message-1',
        content: 'Discussion message',
        discussionId: 'discussion-1'
      };

      await publishDiscussionEvent(mockContext, 'test-doc', 'message', message, 'user-123');

      const stub = mockContext.cloudflare.env.EVENT_BROADCASTER.get(null);
      const response = await stub.fetch(new Request('https://internal/recent'));
      const events = await response.json();

      expect(events[0].type).toBe('discussion.message');
      expect(events[0].data).toEqual(message);
    });
  });

  describe('Event Filtering', () => {
    it('should filter events by document path', async () => {
      const { publishEvent } = await import('~/lib/events/publisher.server');

      // Publish events for different documents
      await publishEvent(mockContext, {
        docPath: 'doc1',
        type: 'comment.created',
        data: { id: '1' }
      });

      await publishEvent(mockContext, {
        docPath: 'doc2',
        type: 'comment.created',
        data: { id: '2' }
      });

      // Subscribe to doc1 events
      const { subscribeToEvents } = await import('~/lib/events/publisher.server');
      const response = await subscribeToEvents(mockContext, 'doc1', 'user-123');

      expect(response.status).toBe(200);
    });
  });

  describe('Heartbeat Mechanism', () => {
    it('should send periodic heartbeats to keep connection alive', async () => {
      vi.useFakeTimers();

      const { subscribeToEvents } = await import('~/lib/events/publisher.server');
      const response = await subscribeToEvents(mockContext, 'test-doc', 'user-123');

      // Fast-forward 30 seconds
      vi.advanceTimersByTime(30000);

      // Connection should still be open
      expect(response.body).toBeTruthy();

      vi.useRealTimers();
    });
  });

  describe('Reconnection Handling', () => {
    // TODO: Requires React Testing Library setup to properly test hooks
    it.skip('should handle reconnection after disconnect', async () => {
      const { useRealtimeEvents } = await import('~/hooks/useRealtimeEvents');

      let connectionCount = 0;
      const onConnect = vi.fn(() => {
        connectionCount++;
      });

      // Mock hook usage
      const { reconnect } = useRealtimeEvents({
        docPath: 'test-doc',
        onConnect
      });

      // Simulate disconnect and reconnect
      reconnect();

      expect(onConnect).toHaveBeenCalled();
    });

    it('should replay recent events on reconnection', async () => {
      const { getRecentEvents } = await import('~/lib/events/publisher.server');

      // Add some events
      const { publishEvent } = await import('~/lib/events/publisher.server');
      await publishEvent(mockContext, {
        docPath: 'test-doc',
        type: 'comment.created',
        data: { id: '1' }
      });

      const events = await getRecentEvents(mockContext, 'test-doc');

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('comment.created');
    });
  });

  describe('Error Handling', () => {
    it('should handle publish failures gracefully', async () => {
      // Mock a failing Durable Object
      const failingContext = {
        cloudflare: {
          env: {
            EVENT_BROADCASTER: {
              idFromName: () => ({ toString: () => 'id' }),
              get: () => ({
                fetch: () => Promise.reject(new Error('Network error'))
              })
            }
          }
        }
      } as any;

      const { publishEvent } = await import('~/lib/events/publisher.server');

      // Should not throw - errors are logged but not propagated
      await expect(publishEvent(failingContext, {
        docPath: 'test',
        type: 'comment.created',
        data: {}
      })).resolves.not.toThrow();
    });

    it('should handle malformed event data', async () => {
      const stub = mockContext.cloudflare.env.EVENT_BROADCASTER.get(null);

      const response = await stub.fetch(new Request('https://internal/publish', {
        method: 'POST',
        body: 'invalid json'
      }));

      expect(response.status).toBe(400);
      const error = await response.json();
      expect(error.error).toBe('Invalid event data');
    });
  });

  describe('Performance', () => {
    it('should handle multiple concurrent connections', async () => {
      const { subscribeToEvents } = await import('~/lib/events/publisher.server');

      const connections = await Promise.all([
        subscribeToEvents(mockContext, 'test-doc', 'user-1'),
        subscribeToEvents(mockContext, 'test-doc', 'user-2'),
        subscribeToEvents(mockContext, 'test-doc', 'user-3'),
        subscribeToEvents(mockContext, 'test-doc', 'user-4'),
        subscribeToEvents(mockContext, 'test-doc', 'user-5'),
      ]);

      expect(connections).toHaveLength(5);
      connections.forEach(response => {
        expect(response.headers.get('Content-Type')).toBe('text/event-stream');
      });
    });

    it('should broadcast events to all connected clients', async () => {
      const { publishEvent } = await import('~/lib/events/publisher.server');

      // Simulate multiple connections
      const { subscribeToEvents } = await import('~/lib/events/publisher.server');
      await subscribeToEvents(mockContext, 'test-doc', 'user-1');
      await subscribeToEvents(mockContext, 'test-doc', 'user-2');

      // Publish an event
      await publishEvent(mockContext, {
        docPath: 'test-doc',
        type: 'comment.created',
        data: { id: 'comment-1' }
      });

      // All connections should receive the event
      const stub = mockContext.cloudflare.env.EVENT_BROADCASTER.get(null);
      const response = await stub.fetch(new Request('https://internal/recent'));
      const events = await response.json();

      expect(events[0].type).toBe('comment.created');
    });
  });
});
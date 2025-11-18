import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loader, action } from './api.discussions.$id.messages';
import {
  createTestUser,
  mockAuth,
  mockUserSync,
} from '../test/helpers/auth-helpers';
import {
  createGetRequest,
  createPostRequest,
  createTestContext,
  parseResponse,
} from '../test/helpers/request-helpers';
import {
  createTestDiscussion,
  createTestDiscussionMessage,
} from '../test/helpers/fixtures';

// Mock dependencies
vi.mock('~/lib/auth/session.server');
vi.mock('~/lib/auth/middleware');
vi.mock('~/lib/db/client.server');
vi.mock('~/lib/db/users.server');
vi.mock('~/lib/events/publisher.server', () => ({
  publishDiscussionEvent: vi.fn().mockResolvedValue(undefined),
  publishCommentEvent: vi.fn().mockResolvedValue(undefined),
  publishSuggestionEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('~/lib/utils/responses', () => ({
  jsonResponse: (data: any, init?: ResponseInit) => {
    return new Response(JSON.stringify(data), {
      status: init?.status || 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
}));
vi.mock('~/lib/utils/request.server', () => ({
  parseRequestPayload: async (request: Request) => {
    return await request.json();
  },
}));

describe('Discussion Messages API Integration Tests', () => {
  let mockDb: any;
  let testUser: any;
  const testDiscussions = new Map<string, any>();
  const testMessages = new Map<string, any>();

  beforeEach(async () => {
    vi.clearAllMocks();
    testDiscussions.clear();
    testMessages.clear();

    testUser = createTestUser({
      id: 'user-001',
      role: 'reviewer',
    });

    await mockAuth(testUser);
    await mockUserSync();

    // Setup mock database
    mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockReturnThis(),
      all: vi.fn(async () => {
        return Array.from(testMessages.values()).filter(m => !m.deletedAt);
      }),
      get: vi.fn(async () => {
        // Check discussions first
        const discussionValues = Array.from(testDiscussions.values());
        const discussion = discussionValues.find(d => !d.deletedAt);
        if (discussion) return discussion;

        // Then check messages
        const messageValues = Array.from(testMessages.values());
        return messageValues.find(m => !m.deletedAt) || null;
      }),
      insert: vi.fn(() => ({
        values: vi.fn(async (data: any) => {
          testMessages.set(data.id, { ...data, author: testUser });
          return data;
        }),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(async () => {}),
        })),
      })),
    };

    const dbModule = await import('~/lib/db/client.server');
    vi.spyOn(dbModule, 'hasDatabase').mockReturnValue(true);
    vi.spyOn(dbModule, 'getDb').mockReturnValue(mockDb);
  });

  describe('GET /api/discussions/:id/messages - List messages', () => {
    it('should return empty array when no messages exist', async () => {
      const discussion = createTestDiscussion({ id: 'discussion-001' });
      testDiscussions.set(discussion.id, discussion);

      mockDb.get.mockResolvedValueOnce(discussion); // Discussion check
      mockDb.all.mockResolvedValue([]); // Messages

      const request = createGetRequest(
        '/api/discussions/discussion-001/messages'
      );
      const context = createTestContext();
      const params = { id: 'discussion-001' };

      const response = await loader({ request, context, params });
      const data = await parseResponse(response);

      expect(response.status).toBe(200);
      expect(data.messages).toEqual([]);
      expect(data.pagination).toBeDefined();
    });

    it('should list messages with author info', async () => {
      const discussion = createTestDiscussion({ id: 'discussion-001' });
      const message1 = createTestDiscussionMessage(discussion.id, {
        id: 'message-001',
      });
      const message2 = createTestDiscussionMessage(discussion.id, {
        id: 'message-002',
      });

      testDiscussions.set(discussion.id, discussion);
      testMessages.set(message1.id, { ...message1, author: testUser });
      testMessages.set(message2.id, { ...message2, author: testUser });

      mockDb.get.mockResolvedValueOnce(discussion);
      mockDb.all.mockResolvedValue([
        { ...message1, author: testUser },
        { ...message2, author: testUser },
      ]);

      const request = createGetRequest(
        '/api/discussions/discussion-001/messages'
      );
      const context = createTestContext();
      const params = { id: 'discussion-001' };

      const response = await loader({ request, context, params });
      const data = await parseResponse(response);

      expect(response.status).toBe(200);
      expect(data.messages).toHaveLength(2);
      expect(data.messages[0].author).toBeDefined();
    });

    it('should order messages by creation time (ascending)', async () => {
      const discussion = createTestDiscussion({ id: 'discussion-001' });
      testDiscussions.set(discussion.id, discussion);

      mockDb.get.mockResolvedValueOnce(discussion);

      const request = createGetRequest(
        '/api/discussions/discussion-001/messages'
      );
      const context = createTestContext();
      const params = { id: 'discussion-001' };

      await loader({ request, context, params });

      expect(mockDb.orderBy).toHaveBeenCalled();
    });

    it('should paginate messages', async () => {
      const discussion = createTestDiscussion({ id: 'discussion-001' });
      testDiscussions.set(discussion.id, discussion);

      mockDb.get.mockResolvedValueOnce(discussion);

      const request = createGetRequest(
        '/api/discussions/discussion-001/messages',
        {
          limit: '20',
          offset: '10',
        }
      );
      const context = createTestContext();
      const params = { id: 'discussion-001' };

      await loader({ request, context, params });

      expect(mockDb.limit).toHaveBeenCalledWith(20);
      expect(mockDb.offset).toHaveBeenCalledWith(10);
    });

    it('should enforce maximum limit of 100', async () => {
      const discussion = createTestDiscussion({ id: 'discussion-001' });
      testDiscussions.set(discussion.id, discussion);

      mockDb.get.mockResolvedValueOnce(discussion);

      const request = createGetRequest(
        '/api/discussions/discussion-001/messages',
        {
          limit: '200',
        }
      );
      const context = createTestContext();
      const params = { id: 'discussion-001' };

      await loader({ request, context, params });

      expect(mockDb.limit).toHaveBeenCalledWith(100);
    });

    it('should exclude soft-deleted messages', async () => {
      const discussion = createTestDiscussion({ id: 'discussion-001' });
      const activeMessage = createTestDiscussionMessage(discussion.id, {
        id: 'message-001',
      });
      const deletedMessage = createTestDiscussionMessage(discussion.id, {
        id: 'message-002',
        deletedAt: Date.now(),
      });

      testDiscussions.set(discussion.id, discussion);
      testMessages.set(activeMessage.id, activeMessage);
      testMessages.set(deletedMessage.id, deletedMessage);

      mockDb.get.mockResolvedValueOnce(discussion);
      mockDb.all.mockResolvedValue([activeMessage]);

      const request = createGetRequest(
        '/api/discussions/discussion-001/messages'
      );
      const context = createTestContext();
      const params = { id: 'discussion-001' };

      const response = await loader({ request, context, params });
      const data = await parseResponse(response);

      expect(data.messages).toHaveLength(1);
      expect(mockDb.where).toHaveBeenCalled();
    });

    it('should return 404 when discussion not found', async () => {
      mockDb.get.mockResolvedValue(null);

      const request = createGetRequest(
        '/api/discussions/non-existent/messages'
      );
      const context = createTestContext();
      const params = { id: 'non-existent' };

      const response = await loader({ request, context, params });
      const data = await parseResponse(response);

      expect(response.status).toBe(404);
      expect(data.error).toContain('Discussion not found');
    });

    it('should return 400 when discussion ID missing', async () => {
      const request = createGetRequest('/api/discussions//messages');
      const context = createTestContext();
      const params = {};

      const response = await loader({ request, context, params });
      const data = await parseResponse(response);

      expect(response.status).toBe(400);
      expect(data.error).toContain('Discussion ID is required');
    });

    it('should return error when database not configured', async () => {
      const dbModule = await import('~/lib/db/client.server');
      vi.spyOn(dbModule, 'hasDatabase').mockReturnValue(false);

      const request = createGetRequest(
        '/api/discussions/discussion-001/messages'
      );
      const context = createTestContext();
      const params = { id: 'discussion-001' };

      const response = await loader({ request, context, params });
      const data = await parseResponse(response);

      expect(response.status).toBe(503);
      expect(data.error).toContain('Database not configured');
    });
  });

  describe('POST /api/discussions/:id/messages - Add message', () => {
    it('should add a message to discussion', async () => {
      const discussion = createTestDiscussion({ id: 'discussion-001' });
      testDiscussions.set(discussion.id, discussion);

      const messageData = {
        content: 'This is a test message',
      };

      const createdMessage = createTestDiscussionMessage(discussion.id, {
        id: 'message-001',
        content: messageData.content,
      });

      mockDb.get
        .mockResolvedValueOnce(discussion) // Discussion check
        .mockResolvedValueOnce({
          ...createdMessage,
          author: testUser,
        }); // Created message

      const request = createPostRequest(
        '/api/discussions/discussion-001/messages',
        messageData
      );
      const context = createTestContext();
      const params = { id: 'discussion-001' };

      const response = await action({ request, context, params });
      const data = await parseResponse(response);

      expect(response.status).toBe(201);
      expect(data.message).toBeDefined();
      expect(data.message.content).toBe(messageData.content);
      expect(data.message.discussionId).toBe(discussion.id);
    });

    it('should update discussion timestamp when message added', async () => {
      const discussion = createTestDiscussion({ id: 'discussion-001' });
      testDiscussions.set(discussion.id, discussion);

      mockDb.get
        .mockResolvedValueOnce(discussion)
        .mockResolvedValueOnce({
          id: 'message-001',
          author: testUser,
        });

      const messageData = {
        content: 'Test message',
      };

      const request = createPostRequest(
        '/api/discussions/discussion-001/messages',
        messageData
      );
      const context = createTestContext();
      const params = { id: 'discussion-001' };

      await action({ request, context, params });

      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should validate required fields', async () => {
      const discussion = createTestDiscussion({ id: 'discussion-001' });
      testDiscussions.set(discussion.id, discussion);

      mockDb.get.mockResolvedValueOnce(discussion);

      const invalidData = {}; // Missing content

      const request = createPostRequest(
        '/api/discussions/discussion-001/messages',
        invalidData
      );
      const context = createTestContext();
      const params = { id: 'discussion-001' };

      const response = await action({ request, context, params });
      const data = await parseResponse(response);

      expect(response.status).toBe(400);
      expect(data.error).toBeDefined();
    });

    it('should return 404 when discussion not found', async () => {
      mockDb.get.mockResolvedValue(null);

      const messageData = {
        content: 'Test message',
      };

      const request = createPostRequest(
        '/api/discussions/non-existent/messages',
        messageData
      );
      const context = createTestContext();
      const params = { id: 'non-existent' };

      const response = await action({ request, context, params });
      const data = await parseResponse(response);

      expect(response.status).toBe(404);
      expect(data.error).toContain('Discussion not found');
    });

    it('should return 400 when discussion ID missing', async () => {
      const messageData = {
        content: 'Test message',
      };

      const request = createPostRequest(
        '/api/discussions//messages',
        messageData
      );
      const context = createTestContext();
      const params = {};

      const response = await action({ request, context, params });
      const data = await parseResponse(response);

      expect(response.status).toBe(400);
      expect(data.error).toContain('Discussion ID is required');
    });

    it('should return 405 for non-POST requests', async () => {
      const request = createGetRequest(
        '/api/discussions/discussion-001/messages'
      );
      const context = createTestContext();
      const params = { id: 'discussion-001' };

      const response = await action({ request, context, params });

      expect(response.status).toBe(405);
    });

    it('should return error when database not configured', async () => {
      const dbModule = await import('~/lib/db/client.server');
      vi.spyOn(dbModule, 'hasDatabase').mockReturnValue(false);

      const messageData = {
        content: 'Test message',
      };

      const request = createPostRequest(
        '/api/discussions/discussion-001/messages',
        messageData
      );
      const context = createTestContext();
      const params = { id: 'discussion-001' };

      const response = await action({ request, context, params });
      const data = await parseResponse(response);

      expect(response.status).toBe(503);
      expect(data.error).toContain('Database not configured');
    });
  });

  describe('Message Threading', () => {
    it('should support multiple messages in a discussion', async () => {
      const discussion = createTestDiscussion({ id: 'discussion-001' });
      const messages = Array.from({ length: 5 }, (_, i) =>
        createTestDiscussionMessage(discussion.id, {
          id: `message-${i.toString().padStart(3, '0')}`,
          content: `Message ${i + 1}`,
        })
      );

      testDiscussions.set(discussion.id, discussion);
      messages.forEach(m => testMessages.set(m.id, m));

      mockDb.get.mockResolvedValueOnce(discussion);
      mockDb.all.mockResolvedValue(messages);

      const request = createGetRequest(
        '/api/discussions/discussion-001/messages'
      );
      const context = createTestContext();
      const params = { id: 'discussion-001' };

      const response = await loader({ request, context, params });
      const data = await parseResponse(response);

      expect(data.messages).toHaveLength(5);
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      mockDb.get.mockRejectedValue(new Error('Database error'));

      const request = createGetRequest(
        '/api/discussions/discussion-001/messages'
      );
      const context = createTestContext();
      const params = { id: 'discussion-001' };

      const response = await loader({ request, context, params });

      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it('should handle validation errors', async () => {
      const discussion = createTestDiscussion({ id: 'discussion-001' });
      mockDb.get.mockResolvedValueOnce(discussion);

      const invalidData = {
        content: '', // Empty content
      };

      const request = createPostRequest(
        '/api/discussions/discussion-001/messages',
        invalidData
      );
      const context = createTestContext();
      const params = { id: 'discussion-001' };

      const response = await action({ request, context, params });
      const data = await parseResponse(response);

      expect(response.status).toBe(400);
      expect(data.error).toBeDefined();
    });
  });
});

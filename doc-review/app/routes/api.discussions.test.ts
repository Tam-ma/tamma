import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loader, action } from './api.discussions';
import { loader as loaderSingle, action as actionSingle } from './api.discussions.$id';
import {
  createTestUser,
  mockAuth,
  mockUserSync,
} from '../test/helpers/auth-helpers';
import {
  createGetRequest,
  createPostRequest,
  createPatchRequest,
  createDeleteRequest,
  createTestContext,
  parseResponse,
} from '../test/helpers/request-helpers';
import {
  createTestDiscussion,
  createTestReviewSession,
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

describe('Discussions API Integration Tests', () => {
  let mockDb: any;
  let testUser: any;
  let adminUser: any;
  const testDiscussions = new Map<string, any>();
  const testSessions = new Map<string, any>();

  beforeEach(async () => {
    vi.clearAllMocks();
    testDiscussions.clear();
    testSessions.clear();

    testUser = createTestUser({
      id: 'user-001',
      role: 'reviewer',
    });

    adminUser = createTestUser({
      id: 'admin-001',
      role: 'admin',
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
        return Array.from(testDiscussions.values()).filter(d => !d.deletedAt);
      }),
      get: vi.fn(async () => {
        const values = Array.from(testDiscussions.values());
        const discussion = values.find(d => !d.deletedAt);
        if (discussion) return discussion;

        // Check sessions
        const sessionValues = Array.from(testSessions.values());
        return sessionValues[0] || null;
      }),
      insert: vi.fn(() => ({
        values: vi.fn(async (data: any) => {
          if (data.title) {
            testDiscussions.set(data.id, { ...data, author: testUser });
          } else {
            testSessions.set(data.id, data);
          }
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

  describe('GET /api/discussions - List discussions', () => {
    it('should return empty array when no discussions exist', async () => {
      mockDb.all.mockResolvedValue([]);

      const request = createGetRequest('/api/discussions');
      const context = createTestContext();

      const response = await loader({ request, context });
      const data = await parseResponse(response);

      expect(response.status).toBe(200);
      expect(data.discussions).toEqual([]);
      expect(data.pagination).toBeDefined();
    });

    it('should list discussions with author info', async () => {
      const discussion = createTestDiscussion({
        id: 'discussion-001',
        userId: testUser.id,
      });

      testDiscussions.set(discussion.id, {
        ...discussion,
        author: testUser,
        messageCount: 3,
      });

      mockDb.all.mockResolvedValue([
        { ...discussion, author: testUser, messageCount: 3 },
      ]);

      const request = createGetRequest('/api/discussions');
      const context = createTestContext();

      const response = await loader({ request, context });
      const data = await parseResponse(response);

      expect(response.status).toBe(200);
      expect(data.discussions).toHaveLength(1);
      expect(data.discussions[0].author).toBeDefined();
    });

    it('should filter discussions by docPath', async () => {
      const request = createGetRequest('/api/discussions', {
        docPath: 'docs/test.md',
      });
      const context = createTestContext();

      await loader({ request, context });

      expect(mockDb.where).toHaveBeenCalled();
    });

    it('should filter discussions by status', async () => {
      const request = createGetRequest('/api/discussions', {
        status: 'open',
      });
      const context = createTestContext();

      await loader({ request, context });

      expect(mockDb.where).toHaveBeenCalled();
    });

    it('should filter discussions by sessionId', async () => {
      const request = createGetRequest('/api/discussions', {
        sessionId: 'session-001',
      });
      const context = createTestContext();

      await loader({ request, context });

      expect(mockDb.where).toHaveBeenCalled();
      expect(mockDb.leftJoin).toHaveBeenCalled();
    });

    it('should filter discussions by userId', async () => {
      const request = createGetRequest('/api/discussions', {
        userId: 'user-001',
      });
      const context = createTestContext();

      await loader({ request, context });

      expect(mockDb.where).toHaveBeenCalled();
    });

    it('should paginate results', async () => {
      const request = createGetRequest('/api/discussions', {
        limit: '10',
        offset: '5',
      });
      const context = createTestContext();

      await loader({ request, context });

      expect(mockDb.limit).toHaveBeenCalledWith(10);
      expect(mockDb.offset).toHaveBeenCalledWith(5);
    });

    it('should enforce maximum limit of 50', async () => {
      const request = createGetRequest('/api/discussions', {
        limit: '100',
      });
      const context = createTestContext();

      await loader({ request, context });

      expect(mockDb.limit).toHaveBeenCalledWith(50);
    });

    it('should exclude soft-deleted discussions', async () => {
      const activeDiscussion = createTestDiscussion({ id: 'discussion-001' });
      const deletedDiscussion = createTestDiscussion({
        id: 'discussion-002',
        deletedAt: Date.now(),
      });

      testDiscussions.set(activeDiscussion.id, activeDiscussion);
      testDiscussions.set(deletedDiscussion.id, deletedDiscussion);

      mockDb.all.mockResolvedValue([activeDiscussion]);

      const request = createGetRequest('/api/discussions');
      const context = createTestContext();

      const response = await loader({ request, context });
      const data = await parseResponse(response);

      expect(data.discussions).toHaveLength(1);
    });

    it('should include message count for each discussion', async () => {
      const discussion = createTestDiscussion({ id: 'discussion-001' });

      mockDb.all.mockResolvedValue([
        { ...discussion, author: testUser, messageCount: 5 },
      ]);

      const request = createGetRequest('/api/discussions');
      const context = createTestContext();

      const response = await loader({ request, context });
      const data = await parseResponse(response);

      expect(data.discussions[0].messageCount).toBe(5);
    });

    it('should return error when database not configured', async () => {
      const dbModule = await import('~/lib/db/client.server');
      vi.spyOn(dbModule, 'hasDatabase').mockReturnValue(false);

      const request = createGetRequest('/api/discussions');
      const context = createTestContext();

      const response = await loader({ request, context });
      const data = await parseResponse(response);

      expect(response.status).toBe(503);
      expect(data.error).toContain('Database not configured');
    });
  });

  describe('POST /api/discussions - Create discussion', () => {
    it('should create a new discussion', async () => {
      const discussionData = {
        docPath: 'docs/test.md',
        title: 'Test Discussion',
        description: 'This is a test discussion',
      };

      const created = createTestDiscussion({
        id: 'discussion-001',
        ...discussionData,
        userId: testUser.id,
      });

      mockDb.get.mockResolvedValue({
        ...created,
        author: testUser,
      });

      const request = createPostRequest('/api/discussions', discussionData);
      const context = createTestContext();

      const response = await action({ request, context });
      const data = await parseResponse(response);

      expect(response.status).toBe(201);
      expect(data.discussion).toBeDefined();
      expect(data.discussion.title).toBe(discussionData.title);
      expect(data.discussion.status).toBe('open');
    });

    it('should create discussion linked to session', async () => {
      const session = createTestReviewSession({
        id: 'session-001',
        ownerId: testUser.id,
        docPaths: JSON.stringify(['docs/test.md']),
      });

      testSessions.set(session.id, session);

      mockDb.get
        .mockResolvedValueOnce(session) // Session lookup
        .mockResolvedValueOnce({
          id: 'discussion-001',
          sessionId: session.id,
          author: testUser,
        }); // Created discussion

      const discussionData = {
        docPath: 'docs/test.md',
        title: 'Session Discussion',
        description: 'Discussion for session',
        sessionId: session.id,
      };

      const request = createPostRequest('/api/discussions', discussionData);
      const context = createTestContext();

      const response = await action({ request, context });
      const data = await parseResponse(response);

      expect(response.status).toBe(201);
      expect(data.discussion.sessionId).toBe(session.id);
    });

    it('should reject discussion for document not in session', async () => {
      const session = createTestReviewSession({
        id: 'session-001',
        ownerId: testUser.id,
        docPaths: JSON.stringify(['docs/other.md']),
      });

      mockDb.get.mockResolvedValueOnce(session);

      const discussionData = {
        docPath: 'docs/test.md', // Not in session
        title: 'Invalid Discussion',
        sessionId: session.id,
      };

      const request = createPostRequest('/api/discussions', discussionData);
      const context = createTestContext();

      const response = await action({ request, context });
      const data = await parseResponse(response);

      expect(response.status).toBe(400);
      expect(data.error).toContain('not part of the selected session');
    });

    it('should return 404 when session not found', async () => {
      mockDb.get.mockResolvedValue(null);

      const discussionData = {
        docPath: 'docs/test.md',
        title: 'Test Discussion',
        sessionId: 'non-existent',
      };

      const request = createPostRequest('/api/discussions', discussionData);
      const context = createTestContext();

      const response = await action({ request, context });
      const data = await parseResponse(response);

      expect(response.status).toBe(404);
      expect(data.error).toContain('Review session not found');
    });

    it('should validate required fields', async () => {
      const invalidData = {
        docPath: 'docs/test.md',
        // Missing title
      };

      const request = createPostRequest('/api/discussions', invalidData);
      const context = createTestContext();

      const response = await action({ request, context });
      const data = await parseResponse(response);

      expect(response.status).toBe(400);
      expect(data.error).toBeDefined();
    });

    it('should return 405 for non-POST requests', async () => {
      const request = createGetRequest('/api/discussions');
      const context = createTestContext();

      const response = await action({ request, context });

      expect(response.status).toBe(405);
    });
  });

  describe('GET /api/discussions/:id - Get single discussion', () => {
    it('should get a discussion by ID', async () => {
      const discussion = createTestDiscussion({ id: 'discussion-001' });

      mockDb.get.mockResolvedValue({
        ...discussion,
        author: testUser,
      });

      const request = createGetRequest('/api/discussions/discussion-001');
      const context = createTestContext();
      const params = { id: 'discussion-001' };

      const response = await loaderSingle({ request, context, params });
      const data = await parseResponse(response);

      expect(response.status).toBe(200);
      expect(data.discussion).toBeDefined();
      expect(data.discussion.id).toBe('discussion-001');
    });

    it('should return 404 for non-existent discussion', async () => {
      mockDb.get.mockResolvedValue(null);

      const request = createGetRequest('/api/discussions/non-existent');
      const context = createTestContext();
      const params = { id: 'non-existent' };

      const response = await loaderSingle({ request, context, params });
      const data = await parseResponse(response);

      expect(response.status).toBe(404);
      expect(data.error).toContain('Discussion not found');
    });

    it('should return 400 when ID missing', async () => {
      const request = createGetRequest('/api/discussions/');
      const context = createTestContext();
      const params = {};

      const response = await loaderSingle({ request, context, params });
      const data = await parseResponse(response);

      expect(response.status).toBe(400);
      expect(data.error).toContain('Discussion ID is required');
    });
  });

  describe('PATCH /api/discussions/:id - Update discussion', () => {
    it('should update discussion title', async () => {
      const discussion = createTestDiscussion({
        id: 'discussion-001',
        userId: testUser.id,
      });

      mockDb.get
        .mockResolvedValueOnce(discussion) // Permission check
        .mockResolvedValueOnce({
          ...discussion,
          title: 'Updated Title',
          author: testUser,
        }); // After update

      const updates = { title: 'Updated Title' };

      const request = createPatchRequest(
        '/api/discussions/discussion-001',
        updates
      );
      const context = createTestContext();
      const params = { id: 'discussion-001' };

      const response = await actionSingle({ request, context, params });
      const data = await parseResponse(response);

      expect(response.status).toBe(200);
      expect(data.discussion).toBeDefined();
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should update discussion status', async () => {
      const discussion = createTestDiscussion({
        id: 'discussion-001',
        userId: testUser.id,
        status: 'open',
      });

      mockDb.get
        .mockResolvedValueOnce(discussion)
        .mockResolvedValueOnce({
          ...discussion,
          status: 'resolved',
          author: testUser,
        });

      const updates = { status: 'resolved' };

      const request = createPatchRequest(
        '/api/discussions/discussion-001',
        updates
      );
      const context = createTestContext();
      const params = { id: 'discussion-001' };

      const response = await actionSingle({ request, context, params });
      const data = await parseResponse(response);

      expect(response.status).toBe(200);
    });

    it('should allow admin to update any discussion', async () => {
      const discussion = createTestDiscussion({
        id: 'discussion-001',
        userId: 'other-user',
      });

      await mockAuth(adminUser);

      mockDb.get
        .mockResolvedValueOnce(discussion)
        .mockResolvedValueOnce({
          ...discussion,
          title: 'Admin Update',
          author: adminUser,
        });

      const updates = { title: 'Admin Update' };

      const request = createPatchRequest(
        '/api/discussions/discussion-001',
        updates
      );
      const context = createTestContext();
      const params = { id: 'discussion-001' };

      const response = await actionSingle({ request, context, params });
      const data = await parseResponse(response);

      expect(response.status).toBe(200);
    });

    it('should prevent unauthorized updates', async () => {
      const discussion = createTestDiscussion({
        id: 'discussion-001',
        userId: 'other-user',
      });

      mockDb.get.mockResolvedValue(discussion);

      const updates = { title: 'Unauthorized Update' };

      const request = createPatchRequest(
        '/api/discussions/discussion-001',
        updates
      );
      const context = createTestContext();
      const params = { id: 'discussion-001' };

      const response = await actionSingle({ request, context, params });
      const data = await parseResponse(response);

      expect(response.status).toBe(403);
      expect(data.error).toContain('do not have permission');
    });

    it('should return 404 for non-existent discussion', async () => {
      mockDb.get.mockResolvedValue(null);

      const updates = { title: 'Updated Title' };

      const request = createPatchRequest(
        '/api/discussions/non-existent',
        updates
      );
      const context = createTestContext();
      const params = { id: 'non-existent' };

      const response = await actionSingle({ request, context, params });
      const data = await parseResponse(response);

      expect(response.status).toBe(404);
      expect(data.error).toContain('Discussion not found');
    });
  });

  describe('DELETE /api/discussions/:id - Delete discussion', () => {
    it('should soft delete owned discussion', async () => {
      const discussion = createTestDiscussion({
        id: 'discussion-001',
        userId: testUser.id,
      });

      mockDb.get.mockResolvedValue(discussion);

      const request = createDeleteRequest('/api/discussions/discussion-001');
      const context = createTestContext();
      const params = { id: 'discussion-001' };

      const response = await actionSingle({ request, context, params });
      const data = await parseResponse(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should allow admin to delete any discussion', async () => {
      const discussion = createTestDiscussion({
        id: 'discussion-001',
        userId: 'other-user',
      });

      await mockAuth(adminUser);
      mockDb.get.mockResolvedValue(discussion);

      const request = createDeleteRequest('/api/discussions/discussion-001');
      const context = createTestContext();
      const params = { id: 'discussion-001' };

      const response = await actionSingle({ request, context, params });
      const data = await parseResponse(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('should prevent unauthorized deletion', async () => {
      const discussion = createTestDiscussion({
        id: 'discussion-001',
        userId: 'other-user',
      });

      mockDb.get.mockResolvedValue(discussion);

      const request = createDeleteRequest('/api/discussions/discussion-001');
      const context = createTestContext();
      const params = { id: 'discussion-001' };

      const response = await actionSingle({ request, context, params });
      const data = await parseResponse(response);

      expect(response.status).toBe(403);
      expect(data.error).toContain('do not have permission');
    });

    it('should return 404 for non-existent discussion', async () => {
      mockDb.get.mockResolvedValue(null);

      const request = createDeleteRequest('/api/discussions/non-existent');
      const context = createTestContext();
      const params = { id: 'non-existent' };

      const response = await actionSingle({ request, context, params });
      const data = await parseResponse(response);

      expect(response.status).toBe(404);
      expect(data.error).toContain('Discussion not found');
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      mockDb.all.mockRejectedValue(new Error('Database error'));

      const request = createGetRequest('/api/discussions');
      const context = createTestContext();

      const response = await loader({ request, context });

      expect(response.status).toBeGreaterThanOrEqual(500);
    });

    it('should handle validation errors', async () => {
      const invalidData = {
        docPath: '',
        title: '',
      };

      const request = createPostRequest('/api/discussions', invalidData);
      const context = createTestContext();

      const response = await action({ request, context });
      const data = await parseResponse(response);

      expect(response.status).toBe(400);
      expect(data.error).toBeDefined();
    });
  });
});

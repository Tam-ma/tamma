import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loader, action } from './api.comments';
import { loader as loaderSingle, action as actionSingle } from './api.comments.$id';
import {
  createTestUser,
  createTestUsers,
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
  createTestComment,
  createThreadedComments,
} from '../test/helpers/fixtures';

// Mock dependencies
vi.mock('~/lib/auth/session.server');
vi.mock('~/lib/auth/middleware');
vi.mock('~/lib/db/client.server');
vi.mock('~/lib/db/users.server');
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

describe('Comments API Integration Tests', () => {
  let mockDb: any;
  let testUser: any;
  const testComments = new Map<string, any>();

  beforeEach(async () => {
    vi.clearAllMocks();
    testComments.clear();

    testUser = createTestUser({
      id: 'user-001',
      email: 'test@example.com',
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
        return Array.from(testComments.values()).filter(c => !c.deletedAt);
      }),
      get: vi.fn(async () => {
        const values = Array.from(testComments.values());
        return values.find(c => !c.deletedAt) || null;
      }),
      insert: vi.fn(() => ({
        values: vi.fn(async (data: any) => {
          testComments.set(data.id, { ...data, author: testUser });
          return data;
        }),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(async () => {
            // Update handled in test assertions
          }),
        })),
      })),
    };

    const dbModule = await import('~/lib/db/client.server');
    vi.spyOn(dbModule, 'hasDatabase').mockReturnValue(true);
    vi.spyOn(dbModule, 'getDb').mockReturnValue(mockDb);
  });

  describe('GET /api/comments - List comments', () => {
    it('should return empty array when no comments exist', async () => {
      const request = createGetRequest('/api/comments');
      const context = createTestContext();

      const response = await loader({ request, context, params: {} });
      const data = await parseResponse(response);

      expect(response.status).toBe(200);
      expect(data.comments).toEqual([]);
      expect(data.pagination).toBeDefined();
      expect(data.pagination.total).toBe(0);
    });

    it('should filter comments by docPath', async () => {
      const comment1 = createTestComment({
        id: 'comment-001',
        docPath: 'docs/test.md',
      });
      const comment2 = createTestComment({
        id: 'comment-002',
        docPath: 'docs/other.md',
      });

      testComments.set(comment1.id, comment1);
      testComments.set(comment2.id, comment2);

      mockDb.all.mockResolvedValue([comment1]);

      const request = createGetRequest('/api/comments', {
        docPath: 'docs/test.md',
      });
      const context = createTestContext();

      const response = await loader({ request, context, params: {} });
      const data = await parseResponse(response);

      expect(response.status).toBe(200);
      expect(mockDb.where).toHaveBeenCalled();
    });

    it('should filter comments by lineNumber', async () => {
      const request = createGetRequest('/api/comments', {
        docPath: 'docs/test.md',
        lineNumber: '10',
      });
      const context = createTestContext();

      await loader({ request, context, params: {} });

      expect(mockDb.where).toHaveBeenCalled();
    });

    it('should filter comments by userId', async () => {
      const request = createGetRequest('/api/comments', {
        userId: 'user-001',
      });
      const context = createTestContext();

      await loader({ request, context, params: {} });

      expect(mockDb.where).toHaveBeenCalled();
    });

    it('should get only top-level comments when parentId=null', async () => {
      const request = createGetRequest('/api/comments', {
        parentId: 'null',
      });
      const context = createTestContext();

      await loader({ request, context, params: {} });

      expect(mockDb.where).toHaveBeenCalled();
    });

    it('should get replies to specific comment', async () => {
      const request = createGetRequest('/api/comments', {
        parentId: 'comment-001',
      });
      const context = createTestContext();

      await loader({ request, context, params: {} });

      expect(mockDb.where).toHaveBeenCalled();
    });

    it('should exclude soft-deleted comments by default', async () => {
      const activeComment = createTestComment({ id: 'comment-001' });
      const deletedComment = createTestComment({
        id: 'comment-002',
        deletedAt: Date.now(),
      });

      testComments.set(activeComment.id, activeComment);
      testComments.set(deletedComment.id, deletedComment);

      mockDb.all.mockResolvedValue([activeComment]);

      const request = createGetRequest('/api/comments');
      const context = createTestContext();

      const response = await loader({ request, context, params: {} });
      const data = await parseResponse(response);

      expect(data.comments).toHaveLength(1);
    });

    it('should include deleted comments when requested', async () => {
      const request = createGetRequest('/api/comments', {
        includeDeleted: 'true',
      });
      const context = createTestContext();

      await loader({ request, context, params: {} });

      expect(mockDb.where).toHaveBeenCalled();
    });

    it('should paginate results', async () => {
      const request = createGetRequest('/api/comments', {
        limit: '10',
        offset: '5',
      });
      const context = createTestContext();

      await loader({ request, context, params: {} });

      expect(mockDb.limit).toHaveBeenCalledWith(10);
      expect(mockDb.offset).toHaveBeenCalledWith(5);
    });

    it('should enforce maximum limit of 100', async () => {
      const request = createGetRequest('/api/comments', {
        limit: '200',
      });
      const context = createTestContext();

      await loader({ request, context, params: {} });

      expect(mockDb.limit).toHaveBeenCalledWith(100);
    });

    it('should return error when database not configured', async () => {
      const dbModule = await import('~/lib/db/client.server');
      vi.spyOn(dbModule, 'hasDatabase').mockReturnValue(false);

      const request = createGetRequest('/api/comments');
      const context = createTestContext();

      const response = await loader({ request, context, params: {} });
      const data = await parseResponse(response);

      expect(response.status).toBe(200);
      expect(data.comments).toEqual([]);
      expect(data.message).toContain('Database not configured');
    });
  });

  describe('POST /api/comments - Create comment', () => {
    it('should create a new comment', async () => {
      const commentData = {
        docPath: 'docs/test.md',
        content: 'This is a test comment',
        lineNumber: 10,
        lineContent: 'const foo = "bar";',
      };

      const createdComment = createTestComment({
        id: 'comment-001',
        ...commentData,
        userId: testUser.id,
      });

      mockDb.get.mockResolvedValue(createdComment);

      const request = createPostRequest('/api/comments', commentData);
      const context = createTestContext();

      const response = await action({ request, context, params: {} });
      const data = await parseResponse(response);

      expect(response.status).toBe(201);
      expect(data.ok).toBe(true);
      expect(data.comment).toBeDefined();
      expect(data.comment.content).toBe(commentData.content);
    });

    it('should create a reply to existing comment', async () => {
      const parentComment = createTestComment({
        id: 'comment-001',
        docPath: 'docs/test.md',
      });

      testComments.set(parentComment.id, parentComment);
      mockDb.get.mockResolvedValueOnce(parentComment); // For parent check
      mockDb.get.mockResolvedValueOnce({
        ...parentComment,
        parentId: parentComment.id,
      }); // For created comment

      const replyData = {
        docPath: 'docs/test.md',
        content: 'This is a reply',
        parentId: parentComment.id,
      };

      const request = createPostRequest('/api/comments', replyData);
      const context = createTestContext();

      const response = await action({ request, context, params: {} });
      const data = await parseResponse(response);

      expect(response.status).toBe(201);
      expect(data.ok).toBe(true);
    });

    it('should return 404 when parent comment not found', async () => {
      mockDb.get.mockResolvedValueOnce(null); // Parent not found

      const replyData = {
        docPath: 'docs/test.md',
        content: 'This is a reply',
        parentId: 'non-existent',
      };

      const request = createPostRequest('/api/comments', replyData);
      const context = createTestContext();

      const response = await action({ request, context, params: {} });
      const data = await parseResponse(response);

      expect(response.status).toBe(404);
      expect(data.error).toContain('Parent comment not found');
    });

    it('should reject reply to comment from different document', async () => {
      const parentComment = createTestComment({
        id: 'comment-001',
        docPath: 'docs/other.md',
      });

      mockDb.get.mockResolvedValueOnce(parentComment);

      const replyData = {
        docPath: 'docs/test.md',
        content: 'This is a reply',
        parentId: parentComment.id,
      };

      const request = createPostRequest('/api/comments', replyData);
      const context = createTestContext();

      const response = await action({ request, context, params: {} });
      const data = await parseResponse(response);

      expect(response.status).toBe(400);
      expect(data.error).toContain('different document');
    });

    it('should validate required fields', async () => {
      const invalidData = {
        docPath: 'docs/test.md',
        // Missing content
      };

      const request = createPostRequest('/api/comments', invalidData);
      const context = createTestContext();

      const response = await action({ request, context, params: {} });
      const data = await parseResponse(response);

      expect(response.status).toBe(400);
      expect(data.error).toBeDefined();
    });

    it('should return 405 for non-POST requests', async () => {
      const request = createGetRequest('/api/comments');
      const context = createTestContext();

      const response = await action({ request, context, params: {} });
      const data = await parseResponse(response);

      expect(response.status).toBe(405);
      expect(data.error).toContain('Method not allowed');
    });

    it('should reject comment creation from viewers (insufficient permissions)', async () => {
      // Mock as viewer who doesn't have comment permission
      const viewerUser = createTestUser({
        id: 'viewer-001',
        email: 'viewer@example.com',
        role: 'viewer',
      });

      await mockAuth(viewerUser);

      const commentData = {
        docPath: 'docs/test.md',
        content: 'Viewer trying to comment',
        lineNumber: 10,
      };

      const request = createPostRequest('/api/comments', commentData);
      const context = createTestContext();

      const response = await action({ request, context, params: {} });
      const data = await parseResponse(response);

      expect(response.status).toBe(403);
      expect(data.error).toBe('Forbidden');
      expect(data.message).toContain('reviewer role or higher');
    });
  });

  describe('GET /api/comments/:id - Get single comment', () => {
    it('should get a comment by ID', async () => {
      const comment = createTestComment({ id: 'comment-001' });

      mockDb.get.mockResolvedValue({
        ...comment,
        author: testUser,
      });

      const request = createGetRequest('/api/comments/comment-001');
      const context = createTestContext();
      const params = { id: 'comment-001' };

      const response = await loaderSingle({ request, context, params });
      const data = await parseResponse(response);

      expect(response.status).toBe(200);
      expect(data.comment).toBeDefined();
      expect(data.comment.id).toBe('comment-001');
    });

    it('should return 404 for non-existent comment', async () => {
      mockDb.get.mockResolvedValue(null);

      const request = createGetRequest('/api/comments/non-existent');
      const context = createTestContext();
      const params = { id: 'non-existent' };

      const response = await loaderSingle({ request, context, params });
      const data = await parseResponse(response);

      expect(response.status).toBe(404);
      expect(data.error).toContain('Comment not found');
    });

    it('should return 400 when ID missing', async () => {
      const request = createGetRequest('/api/comments/');
      const context = createTestContext();
      const params = {};

      const response = await loaderSingle({ request, context, params });
      const data = await parseResponse(response);

      expect(response.status).toBe(400);
      expect(data.error).toContain('Comment ID is required');
    });
  });

  describe('PATCH /api/comments/:id - Update comment', () => {
    it('should update comment content', async () => {
      const comment = createTestComment({
        id: 'comment-001',
        userId: testUser.id,
      });

      mockDb.get
        .mockResolvedValueOnce(comment) // Permission check
        .mockResolvedValueOnce({
          ...comment,
          content: 'Updated content',
        }); // After update

      const updates = { content: 'Updated content' };

      const request = createPatchRequest('/api/comments/comment-001', updates);
      const context = createTestContext();
      const params = { id: 'comment-001' };

      const response = await actionSingle({ request, context, params });
      const data = await parseResponse(response);

      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should update resolved status', async () => {
      const comment = createTestComment({
        id: 'comment-001',
        userId: testUser.id,
        resolved: false,
      });

      mockDb.get
        .mockResolvedValueOnce(comment)
        .mockResolvedValueOnce({ ...comment, resolved: true });

      const updates = { resolved: true };

      const request = createPatchRequest('/api/comments/comment-001', updates);
      const context = createTestContext();
      const params = { id: 'comment-001' };

      const response = await actionSingle({ request, context, params });
      const data = await parseResponse(response);

      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
    });

    it('should prevent unauthorized updates', async () => {
      const comment = createTestComment({
        id: 'comment-001',
        userId: 'other-user',
      });

      mockDb.get.mockResolvedValue(comment);

      const updates = { content: 'Hacked content' };

      const request = createPatchRequest('/api/comments/comment-001', updates);
      const context = createTestContext();
      const params = { id: 'comment-001' };

      const response = await actionSingle({ request, context, params });
      const data = await parseResponse(response);

      expect(response.status).toBe(403);
      expect(data.error).toContain('not authorized');
    });

    it('should return 404 for non-existent comment', async () => {
      mockDb.get.mockResolvedValue(null);

      const updates = { content: 'Updated content' };

      const request = createPatchRequest('/api/comments/non-existent', updates);
      const context = createTestContext();
      const params = { id: 'non-existent' };

      const response = await actionSingle({ request, context, params });
      const data = await parseResponse(response);

      expect(response.status).toBe(404);
      expect(data.error).toContain('Comment not found');
    });

    it('should allow admin to update any comment', async () => {
      // Create comment owned by another user
      const comment = createTestComment({
        id: 'comment-001',
        userId: 'other-user',
      });

      // Mock as admin
      const adminUser = createTestUser({
        id: 'admin-001',
        email: 'admin@example.com',
        role: 'admin',
      });

      await mockAuth(adminUser);

      mockDb.get
        .mockResolvedValueOnce(comment) // Permission check
        .mockResolvedValueOnce({
          ...comment,
          content: 'Admin updated content',
        }); // After update

      const updates = { content: 'Admin updated content' };

      const request = createPatchRequest('/api/comments/comment-001', updates);
      const context = createTestContext();
      const params = { id: 'comment-001' };

      const response = await actionSingle({ request, context, params });
      const data = await parseResponse(response);

      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
    });
  });

  describe('DELETE /api/comments/:id - Delete comment', () => {
    it('should soft delete owned comment', async () => {
      const comment = createTestComment({
        id: 'comment-001',
        userId: testUser.id,
      });

      mockDb.get.mockResolvedValue(comment);

      const request = createDeleteRequest('/api/comments/comment-001');
      const context = createTestContext();
      const params = { id: 'comment-001' };

      const response = await actionSingle({ request, context, params });
      const data = await parseResponse(response);

      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.message).toContain('deleted successfully');
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should prevent unauthorized deletion', async () => {
      const comment = createTestComment({
        id: 'comment-001',
        userId: 'other-user',
      });

      mockDb.get.mockResolvedValue(comment);

      const request = createDeleteRequest('/api/comments/comment-001');
      const context = createTestContext();
      const params = { id: 'comment-001' };

      const response = await actionSingle({ request, context, params });
      const data = await parseResponse(response);

      expect(response.status).toBe(403);
      expect(data.error).toContain('not authorized');
    });

    it('should return 404 for non-existent comment', async () => {
      mockDb.get.mockResolvedValue(null);

      const request = createDeleteRequest('/api/comments/non-existent');
      const context = createTestContext();
      const params = { id: 'non-existent' };

      const response = await actionSingle({ request, context, params });
      const data = await parseResponse(response);

      expect(response.status).toBe(404);
      expect(data.error).toContain('Comment not found');
    });

    it('should allow admin to delete any comment', async () => {
      // Create comment owned by another user
      const comment = createTestComment({
        id: 'comment-001',
        userId: 'other-user',
      });

      // Mock as admin
      const adminUser = createTestUser({
        id: 'admin-001',
        email: 'admin@example.com',
        role: 'admin',
      });

      await mockAuth(adminUser);

      mockDb.get.mockResolvedValue(comment);

      const request = createDeleteRequest('/api/comments/comment-001');
      const context = createTestContext();
      const params = { id: 'comment-001' };

      const response = await actionSingle({ request, context, params });
      const data = await parseResponse(response);

      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.message).toContain('deleted successfully');
      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  describe('Comment Threading', () => {
    it('should support nested comment threads', async () => {
      const [parent, reply1, reply2] = createThreadedComments({}, 2);

      testComments.set(parent.id, parent);
      testComments.set(reply1.id, reply1);
      testComments.set(reply2.id, reply2);

      mockDb.all.mockResolvedValue([reply1, reply2]);

      const request = createGetRequest('/api/comments', {
        parentId: parent.id,
      });
      const context = createTestContext();

      const response = await loader({ request, context, params: {} });
      const data = await parseResponse(response);

      expect(response.status).toBe(200);
      expect(mockDb.where).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      mockDb.all.mockRejectedValue(new Error('Database error'));

      const request = createGetRequest('/api/comments');
      const context = createTestContext();

      const response = await loader({ request, context, params: {} });
      const data = await parseResponse(response);

      expect(response.status).toBe(500);
      expect(data.error).toContain('Failed to fetch comments');
    });

    it('should handle validation errors', async () => {
      const invalidData = {
        docPath: '', // Invalid empty path
        content: 'Test',
      };

      const request = createPostRequest('/api/comments', invalidData);
      const context = createTestContext();

      const response = await action({ request, context, params: {} });
      const data = await parseResponse(response);

      expect(response.status).toBe(400);
      expect(data.error).toBeDefined();
    });
  });
});

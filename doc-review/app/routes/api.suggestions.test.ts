import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loader, action } from './api.suggestions';
import * as Diff from 'diff';
import { createTestUser, mockAuth, mockUserSync } from '../test/helpers/auth-helpers';

// Mock dependencies
vi.mock('~/lib/auth/session.server');
vi.mock('~/lib/auth/middleware');
vi.mock('~/lib/db/client.server');
vi.mock('~/lib/db/users.server');
vi.mock('~/lib/git/provider.server');

describe('Suggestions API', () => {
  let mockDb: any;
  let testUser: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Set up test user with reviewer role (can create suggestions)
    testUser = createTestUser({
      id: 'user-123',
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
      all: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
      $dynamic: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      values: vi.fn().mockResolvedValue(undefined),
    };

    const dbModule = await import('~/lib/db/client.server');
    vi.spyOn(dbModule, 'hasDatabase').mockReturnValue(true);
    vi.spyOn(dbModule, 'getDb').mockReturnValue(mockDb);
  });

  describe('GET /api/suggestions', () => {
    it('should return empty array when no suggestions exist', async () => {
      const request = new Request('http://localhost/api/suggestions');
      const context = { env: {} };
      const params = {};

      const response = await loader({ request, context, params });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.suggestions).toEqual([]);
      expect(data.pagination).toEqual({
        limit: 50,
        offset: 0,
        hasMore: false,
      });
    });

    it('should filter suggestions by docPath', async () => {
      const request = new Request('http://localhost/api/suggestions?docPath=docs/test.md');
      const context = { env: {} };
      const params = {};

      await loader({ request, context, params });

      // Verify where clause was called with correct filter
      expect(mockDb.where).toHaveBeenCalled();
    });

    it('should paginate results', async () => {
      const request = new Request('http://localhost/api/suggestions?limit=10&offset=20');
      const context = { env: {} };
      const params = {};

      await loader({ request, context, params });

      expect(mockDb.limit).toHaveBeenCalledWith(10);
      expect(mockDb.offset).toHaveBeenCalledWith(20);
    });

    it('should get a specific suggestion by ID', async () => {
      const suggestionId = 'suggestion-123';
      const mockSuggestion = {
        id: suggestionId,
        docPath: 'docs/test.md',
        originalText: 'old text',
        suggestedText: 'new text',
        lineStart: 1,
        lineEnd: 1,
        status: 'pending',
        author: { id: 'user-123', name: 'Test User' },
        session: null,
      };

      mockDb.get.mockResolvedValue(mockSuggestion);

      const request = new Request('http://localhost/api/suggestions');
      const context = { env: {} };
      const params = { id: suggestionId };

      const response = await loader({ request, context, params });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.suggestion.id).toBe(suggestionId);
      expect(data.suggestion.diff).toBeDefined();
    });

    it('should return 404 for non-existent suggestion', async () => {
      mockDb.get.mockResolvedValue(null);

      const request = new Request('http://localhost/api/suggestions');
      const context = { env: {} };
      const params = { id: 'non-existent' };

      const response = await loader({ request, context, params });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Suggestion not found.');
    });
  });

  describe('POST /api/suggestions', () => {
    it('should create a new suggestion', async () => {
      const suggestionData = {
        docPath: 'docs/test.md',
        description: 'Fix typo',
        originalText: 'teh',
        suggestedText: 'the',
        lineStart: 10,
        lineEnd: 10,
      };

      mockDb.get.mockResolvedValue({ id: 'new-suggestion', ...suggestionData });

      const request = new Request('http://localhost/api/suggestions', {
        method: 'POST',
        body: JSON.stringify(suggestionData),
        headers: { 'Content-Type': 'application/json' },
      });
      const context = { env: {} };
      const params = {};

      const response = await action({ request, context, params });
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.ok).toBe(true);
      expect(data.suggestion).toBeDefined();
      expect(data.suggestion.diff).toBeDefined();
    });

    it('should validate required fields', async () => {
      const request = new Request('http://localhost/api/suggestions', {
        method: 'POST',
        body: JSON.stringify({ docPath: 'test.md' }), // Missing required fields
        headers: { 'Content-Type': 'application/json' },
      });
      const context = { env: {} };
      const params = {};

      const response = await action({ request, context, params });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBeDefined();
    });

    it('should reject suggestion creation from viewers (insufficient permissions)', async () => {
      // Mock as viewer who doesn't have suggest permission
      const viewerUser = createTestUser({
        id: 'viewer-001',
        email: 'viewer@example.com',
        role: 'viewer',
      });

      await mockAuth(viewerUser);

      const suggestionData = {
        docPath: 'docs/test.md',
        description: 'Fix typo',
        originalText: 'teh',
        suggestedText: 'the',
        lineStart: 10,
        lineEnd: 10,
      };

      const request = new Request('http://localhost/api/suggestions', {
        method: 'POST',
        body: JSON.stringify(suggestionData),
        headers: { 'Content-Type': 'application/json' },
      });
      const context = { env: {} };
      const params = {};

      const response = await action({ request, context, params });
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe('Forbidden');
      expect(data.message).toContain('reviewer role or higher');
    });
  });

  describe('PATCH /api/suggestions/:id', () => {
    it('should update suggestion description', async () => {
      const suggestionId = 'suggestion-123';
      const existing = {
        id: suggestionId,
        userId: 'user-123',
        status: 'pending',
      };

      mockDb.get
        .mockResolvedValueOnce(existing) // For permission check
        .mockResolvedValueOnce({ ...existing, description: 'Updated description' }); // After update

      const request = new Request('http://localhost/api/suggestions', {
        method: 'PATCH',
        body: JSON.stringify({ description: 'Updated description' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const context = { env: {} };
      const params = { id: suggestionId };

      const response = await action({ request, context, params });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should require admin role to approve suggestions', async () => {
      const suggestionId = 'suggestion-123';
      const existing = {
        id: suggestionId,
        userId: 'other-user',
        status: 'pending',
      };

      mockDb.get.mockResolvedValueOnce(existing);

      // Reviewer trying to approve (should fail)
      const request = new Request('http://localhost/api/suggestions', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'approved' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const context = { env: {} };
      const params = { id: suggestionId };

      const response = await action({ request, context, params });
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toContain('Only admins');
    });

    it('should allow admin to approve suggestion', async () => {
      // Mock as admin
      const adminUser = createTestUser({
        id: 'admin-001',
        email: 'admin@example.com',
        role: 'admin',
      });

      await mockAuth(adminUser);

      const suggestionId = 'suggestion-123';
      const existing = {
        id: suggestionId,
        userId: 'other-user',
        status: 'pending',
        sessionId: null, // No session to avoid PR creation
      };

      mockDb.get
        .mockResolvedValueOnce(existing) // For permission check
        .mockResolvedValueOnce({ ...existing, status: 'approved' }); // After update

      const request = new Request('http://localhost/api/suggestions', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'approved' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const context = { env: {} };
      const params = { id: suggestionId };

      const response = await action({ request, context, params });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
    });

    it('should return 404 for non-existent suggestion', async () => {
      mockDb.get.mockResolvedValue(null);

      const request = new Request('http://localhost/api/suggestions', {
        method: 'PATCH',
        body: JSON.stringify({ description: 'Updated' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const context = { env: {} };
      const params = { id: 'non-existent' };

      const response = await action({ request, context, params });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Suggestion not found.');
    });
  });

  describe('DELETE /api/suggestions/:id', () => {
    it('should soft delete owned suggestion', async () => {
      const suggestionId = 'suggestion-123';
      const existing = {
        id: suggestionId,
        userId: 'user-123',
      };

      mockDb.get.mockResolvedValueOnce(existing);

      const request = new Request('http://localhost/api/suggestions', {
        method: 'DELETE',
      });
      const context = { env: {} };
      const params = { id: suggestionId };

      const response = await action({ request, context, params });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.message).toBe('Suggestion deleted successfully.');
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          deletedAt: expect.any(Number),
          status: 'deleted',
        })
      );
    });

    it('should prevent unauthorized deletion', async () => {
      const suggestionId = 'suggestion-123';
      const existing = {
        id: suggestionId,
        userId: 'other-user',
      };

      mockDb.get.mockResolvedValueOnce(existing);

      const request = new Request('http://localhost/api/suggestions', {
        method: 'DELETE',
      });
      const context = { env: {} };
      const params = { id: suggestionId };

      const response = await action({ request, context, params });
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe('Unauthorized to delete this suggestion.');
    });

    it('should return 404 for non-existent suggestion', async () => {
      mockDb.get.mockResolvedValue(null);

      const request = new Request('http://localhost/api/suggestions', {
        method: 'DELETE',
      });
      const context = { env: {} };
      const params = { id: 'non-existent' };

      const response = await action({ request, context, params });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Suggestion not found.');
    });

    it('should allow admin to delete any suggestion', async () => {
      // Mock as admin
      const adminUser = createTestUser({
        id: 'admin-001',
        email: 'admin@example.com',
        role: 'admin',
      });

      await mockAuth(adminUser);

      const suggestionId = 'suggestion-123';
      const existing = {
        id: suggestionId,
        userId: 'other-user',
      };

      mockDb.get.mockResolvedValueOnce(existing);

      const request = new Request('http://localhost/api/suggestions', {
        method: 'DELETE',
      });
      const context = { env: {} };
      const params = { id: suggestionId };

      const response = await action({ request, context, params });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.message).toBe('Suggestion deleted successfully.');
      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  describe('Diff generation', () => {
    it('should generate diff for suggestions', () => {
      const originalText = 'The quick brown fox';
      const suggestedText = 'The fast brown fox';

      const diff = Diff.createPatch(
        'test.md',
        originalText,
        suggestedText,
        'original',
        'suggested'
      );

      expect(diff).toContain('--- test.md	original');
      expect(diff).toContain('+++ test.md	suggested');
      expect(diff).toContain('-The quick brown fox');
      expect(diff).toContain('+The fast brown fox');
    });
  });
});
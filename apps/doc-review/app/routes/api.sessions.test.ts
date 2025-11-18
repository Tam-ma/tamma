import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loader, action } from './api.sessions';
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
import { createTestReviewSession } from '../test/helpers/fixtures';

// Mock dependencies
vi.mock('~/lib/auth/session.server');
vi.mock('~/lib/auth/middleware');
vi.mock('~/lib/db/client.server');
vi.mock('~/lib/db/users.server');
vi.mock('~/lib/db/sessions.server');
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

describe('Sessions API Integration Tests', () => {
  let testUser: any;
  const testSessions: any[] = [];

  beforeEach(async () => {
    vi.clearAllMocks();
    testSessions.length = 0;

    testUser = createTestUser({
      id: 'user-001',
      role: 'reviewer',
    });

    await mockAuth(testUser);
    await mockUserSync();

    const dbModule = await import('~/lib/db/client.server');
    vi.spyOn(dbModule, 'hasDatabase').mockReturnValue(true);

    // Mock sessions module
    const sessionsModule = await import('~/lib/db/sessions.server');
    vi.spyOn(sessionsModule, 'listSessions').mockImplementation(
      async (_env: any, docPath?: string) => {
        if (docPath) {
          return testSessions.filter(s =>
            JSON.parse(s.docPaths).includes(docPath)
          );
        }
        return testSessions;
      }
    );

    vi.spyOn(sessionsModule, 'createSession').mockImplementation(
      async (_env: any, user: any, input: any) => {
        const sessionFixture = createTestReviewSession({
          id: crypto.randomUUID(),
          title: input.title,
          summary: input.summary,
          docPaths: JSON.stringify(input.docPaths),
          primaryDocPath: input.docPaths[0],
          ownerId: user.id,
        });
        testSessions.push(sessionFixture);
        // Return the transformed version matching ReviewSession type
        return {
          ...sessionFixture,
          docPaths: input.docPaths, // Transform from JSON string to array
        };
      }
    );
  });

  describe('GET /api/sessions - List sessions', () => {
    it('should return empty array when no sessions exist', async () => {
      const request = createGetRequest('/api/sessions');
      const context = createTestContext();

      const response = await loader({ request, context });
      const data = await parseResponse(response);

      expect(response.status).toBe(200);
      expect(data.sessions).toEqual([]);
    });

    it('should list all sessions', async () => {
      const session1 = createTestReviewSession({
        id: 'session-001',
        ownerId: testUser.id,
      });
      const session2 = createTestReviewSession({
        id: 'session-002',
        ownerId: testUser.id,
      });

      testSessions.push(session1, session2);

      const request = createGetRequest('/api/sessions');
      const context = createTestContext();

      const response = await loader({ request, context });
      const data = await parseResponse(response);

      expect(response.status).toBe(200);
      expect(data.sessions).toHaveLength(2);
    });

    it('should filter sessions by docPath', async () => {
      const session1 = createTestReviewSession({
        id: 'session-001',
        ownerId: testUser.id,
        docPaths: JSON.stringify(['docs/test.md', 'docs/example.md']),
      });
      const session2 = createTestReviewSession({
        id: 'session-002',
        ownerId: testUser.id,
        docPaths: JSON.stringify(['docs/other.md']),
      });

      testSessions.push(session1, session2);

      const request = createGetRequest('/api/sessions', {
        docPath: 'docs/test.md',
      });
      const context = createTestContext();

      const response = await loader({ request, context });
      const data = await parseResponse(response);

      expect(response.status).toBe(200);
      expect(data.sessions).toHaveLength(1);
      expect(data.sessions[0].id).toBe('session-001');
    });

    it('should return empty array when database not configured', async () => {
      const dbModule = await import('~/lib/db/client.server');
      vi.spyOn(dbModule, 'hasDatabase').mockReturnValue(false);

      const request = createGetRequest('/api/sessions');
      const context = createTestContext();

      const response = await loader({ request, context });
      const data = await parseResponse(response);

      expect(response.status).toBe(200);
      expect(data.sessions).toEqual([]);
    });
  });

  describe('POST /api/sessions - Create session', () => {
    it('should create a new review session', async () => {
      const sessionData = {
        title: 'Test Review Session',
        summary: 'Reviewing test documentation',
        docPaths: ['docs/test.md', 'docs/example.md'],
      };

      const request = createPostRequest('/api/sessions', sessionData);
      const context = createTestContext();

      const response = await action({ request, context });
      const data = await parseResponse(response);

      expect(response.status).toBe(201);
      expect(data.ok).toBe(true);
      expect(data.session).toBeDefined();
      expect(data.session.title).toBe(sessionData.title);
      expect(data.session.ownerId).toBe(testUser.id);
      expect(data.session.status).toBe('draft');
    });

    it('should create session with multiple documents', async () => {
      const sessionData = {
        title: 'Multi-doc Review',
        summary: 'Review multiple documents',
        docPaths: ['docs/test1.md', 'docs/test2.md', 'docs/test3.md'],
      };

      const request = createPostRequest('/api/sessions', sessionData);
      const context = createTestContext();

      const response = await action({ request, context });
      const data = await parseResponse(response);

      expect(response.status).toBe(201);
      expect(data.session).toBeDefined();

      const docPaths = JSON.parse(data.session.docPaths);
      expect(docPaths).toHaveLength(3);
    });

    it('should set primary doc path as first document', async () => {
      const sessionData = {
        title: 'Test Session',
        summary: 'Test',
        docPaths: ['docs/primary.md', 'docs/secondary.md'],
      };

      const request = createPostRequest('/api/sessions', sessionData);
      const context = createTestContext();

      const response = await action({ request, context });
      const data = await parseResponse(response);

      expect(data.session.primaryDocPath).toBe('docs/primary.md');
    });

    it('should validate required fields', async () => {
      const invalidData = {
        title: 'Test Session',
        // Missing docPaths
      };

      const request = createPostRequest('/api/sessions', invalidData);
      const context = createTestContext();

      const response = await action({ request, context });
      const data = await parseResponse(response);

      expect(response.status).toBe(400);
      expect(data.error).toBeDefined();
    });

    it('should validate docPaths is an array', async () => {
      const invalidData = {
        title: 'Test Session',
        summary: 'Test',
        docPaths: 'docs/test.md', // Should be array
      };

      const request = createPostRequest('/api/sessions', invalidData);
      const context = createTestContext();

      const response = await action({ request, context });
      const data = await parseResponse(response);

      expect(response.status).toBe(400);
      expect(data.error).toBeDefined();
    });

    it('should validate docPaths is not empty', async () => {
      const invalidData = {
        title: 'Test Session',
        summary: 'Test',
        docPaths: [],
      };

      const request = createPostRequest('/api/sessions', invalidData);
      const context = createTestContext();

      const response = await action({ request, context });
      const data = await parseResponse(response);

      expect(response.status).toBe(400);
      expect(data.error).toBeDefined();
    });

    it('should return 405 for non-POST requests', async () => {
      const request = createGetRequest('/api/sessions');
      const context = createTestContext();

      const response = await action({ request, context });

      expect(response.status).toBe(405);
    });

    it('should return error when database not configured', async () => {
      const dbModule = await import('~/lib/db/client.server');
      vi.spyOn(dbModule, 'hasDatabase').mockReturnValue(false);

      const sessionData = {
        title: 'Test Session',
        summary: 'Test',
        docPaths: ['docs/test.md'],
      };

      const request = createPostRequest('/api/sessions', sessionData);
      const context = createTestContext();

      const response = await action({ request, context });
      const data = await parseResponse(response);

      expect(response.status).toBe(503);
      expect(data.error).toContain('Database not configured');
    });
  });

  describe('Session Workflow', () => {
    it('should create session and link to suggestions', async () => {
      const sessionData = {
        title: 'Documentation Review',
        summary: 'Review and improve documentation',
        docPaths: ['docs/architecture.md', 'docs/README.md'],
      };

      const request = createPostRequest('/api/sessions', sessionData);
      const context = createTestContext();

      const response = await action({ request, context });
      const data = await parseResponse(response);

      expect(response.status).toBe(201);
      expect(data.session.id).toBeDefined();

      // Session ID can be used to link suggestions
      const sessionId = data.session.id;
      expect(sessionId).toBeTruthy();
    });

    it('should track session status', async () => {
      const sessionData = {
        title: 'Test Session',
        summary: 'Test',
        docPaths: ['docs/test.md'],
      };

      const request = createPostRequest('/api/sessions', sessionData);
      const context = createTestContext();

      const response = await action({ request, context });
      const data = await parseResponse(response);

      expect(data.session.status).toBe('draft');
      expect(data.session.branch).toBeNull();
      expect(data.session.prNumber).toBeNull();
      expect(data.session.prUrl).toBeNull();
    });
  });

  describe('Error Handling', () => {
    it('should handle session creation errors', async () => {
      const sessionsModule = await import('~/lib/db/sessions.server');
      vi.spyOn(sessionsModule, 'createSession').mockRejectedValue(
        new Error('Database error')
      );

      const sessionData = {
        title: 'Test Session',
        summary: 'Test',
        docPaths: ['docs/test.md'],
      };

      const request = createPostRequest('/api/sessions', sessionData);
      const context = createTestContext();

      const response = await action({ request, context });
      const data = await parseResponse(response);

      expect(response.status).toBe(500);
      expect(data.error).toContain('Failed to create review session');
    });

    it('should handle validation errors', async () => {
      const invalidData = {
        title: '', // Empty title
        summary: 'Test',
        docPaths: ['docs/test.md'],
      };

      const request = createPostRequest('/api/sessions', invalidData);
      const context = createTestContext();

      const response = await action({ request, context });
      const data = await parseResponse(response);

      expect(response.status).toBe(400);
      expect(data.error).toBeDefined();
    });
  });

  describe('Session Management', () => {
    it('should create sessions with unique IDs', async () => {
      const sessionData = {
        title: 'Session 1',
        summary: 'Test',
        docPaths: ['docs/test.md'],
      };

      const request1 = createPostRequest('/api/sessions', sessionData);
      const request2 = createPostRequest('/api/sessions', {
        ...sessionData,
        title: 'Session 2',
      });

      const context = createTestContext();

      const response1 = await action({ request: request1, context });
      const response2 = await action({ request: request2, context });

      const data1 = await parseResponse(response1);
      const data2 = await parseResponse(response2);

      expect(data1.session.id).not.toBe(data2.session.id);
    });

    it('should track session owner', async () => {
      const sessionData = {
        title: 'Test Session',
        summary: 'Test',
        docPaths: ['docs/test.md'],
      };

      const request = createPostRequest('/api/sessions', sessionData);
      const context = createTestContext();

      const response = await action({ request, context });
      const data = await parseResponse(response);

      expect(data.session.ownerId).toBe(testUser.id);
    });

    it('should create sessions with timestamps', async () => {
      const sessionData = {
        title: 'Test Session',
        summary: 'Test',
        docPaths: ['docs/test.md'],
      };

      const request = createPostRequest('/api/sessions', sessionData);
      const context = createTestContext();

      const response = await action({ request, context });
      const data = await parseResponse(response);

      expect(data.session.createdAt).toBeDefined();
      expect(data.session.updatedAt).toBeDefined();
      expect(typeof data.session.createdAt).toBe('number');
      expect(typeof data.session.updatedAt).toBe('number');
    });
  });
});

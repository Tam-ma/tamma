import { describe, it, expect, beforeEach, vi } from 'vitest';
import { requireRole, requirePermission, checkCanApprove, checkCanManageUsers } from './middleware';
import { Role, Permission } from './permissions';

// Mock the session and user modules
vi.mock('./session.server', () => ({
  requireAuth: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock('~/lib/db/users.server', () => ({
  getUserById: vi.fn(),
}));

vi.mock('~/lib/utils/responses', () => ({
  jsonResponse: vi.fn((data, options = {}) => ({
    ...data,
    status: options.status || 200,
  })),
}));

describe('RBAC Middleware', () => {
  const mockRequest = new Request('http://localhost/test');
  const mockContext = {
    env: {
      DB: {},
      CACHE: {},
    },
    cloudflare: {
      env: {
        DB: {},
        CACHE: {},
      },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('requireRole', () => {
    it('should allow users with sufficient role', async () => {
      const { getUserById } = await import('~/lib/db/users.server');
      const mockGetUserById = getUserById as any;

      mockGetUserById.mockResolvedValue({
        id: 'user-1',
        role: 'admin',
        email: 'admin@test.com',
        name: 'Admin User',
      });

      const middleware = requireRole(Role.REVIEWER);
      const args = { request: mockRequest, context: mockContext, params: {} };

      // Mock requireAuth to return a user
      const { requireAuth } = await import('./session.server');
      const mockRequireAuth = requireAuth as any;
      mockRequireAuth.mockResolvedValue({
        id: 'user-1',
        username: 'admin',
        email: 'admin@test.com',
        name: 'Admin User',
      });

      const result = await middleware(args);

      // Should return the user object, not a Response
      expect(result).toHaveProperty('id', 'user-1');
      expect(result).toHaveProperty('role', 'admin');
    });

    it('should deny users with insufficient role', async () => {
      const { getUserById } = await import('~/lib/db/users.server');
      const mockGetUserById = getUserById as any;

      mockGetUserById.mockResolvedValue({
        id: 'user-1',
        role: 'viewer',
        email: 'viewer@test.com',
        name: 'Viewer User',
      });

      const middleware = requireRole(Role.ADMIN);
      const args = { request: mockRequest, context: mockContext, params: {} };

      // Mock requireAuth to return a user
      const { requireAuth } = await import('./session.server');
      const mockRequireAuth = requireAuth as any;
      mockRequireAuth.mockResolvedValue({
        id: 'user-1',
        username: 'viewer',
        email: 'viewer@test.com',
        name: 'Viewer User',
      });

      const result = await middleware(args);

      // Should return a 403 Response
      expect(result).toHaveProperty('status', 403);
      expect(result).toHaveProperty('error', 'Forbidden');
    });

    it('should handle users not in database', async () => {
      const { getUserById } = await import('~/lib/db/users.server');
      const mockGetUserById = getUserById as any;

      mockGetUserById.mockResolvedValue(null);

      const middleware = requireRole(Role.REVIEWER);
      const args = { request: mockRequest, context: mockContext, params: {} };

      // Mock requireAuth to return a user
      const { requireAuth } = await import('./session.server');
      const mockRequireAuth = requireAuth as any;
      mockRequireAuth.mockResolvedValue({
        id: 'user-1',
        username: 'newuser',
        email: 'new@test.com',
        name: 'New User',
      });

      const result = await middleware(args);

      // New users default to viewer, so should be denied for reviewer role
      expect(result).toHaveProperty('status', 403);
    });
  });

  describe('requirePermission', () => {
    it('should allow users with required permission', async () => {
      const { getUserById } = await import('~/lib/db/users.server');
      const mockGetUserById = getUserById as any;

      mockGetUserById.mockResolvedValue({
        id: 'user-1',
        role: 'reviewer',
        email: 'reviewer@test.com',
        name: 'Reviewer User',
      });

      const middleware = requirePermission(Permission.COMMENT);
      const args = { request: mockRequest, context: mockContext, params: {} };

      // Mock requireAuth
      const { requireAuth } = await import('./session.server');
      const mockRequireAuth = requireAuth as any;
      mockRequireAuth.mockResolvedValue({
        id: 'user-1',
        username: 'reviewer',
        email: 'reviewer@test.com',
        name: 'Reviewer User',
      });

      const result = await middleware(args);

      expect(result).toHaveProperty('id', 'user-1');
      expect(result).toHaveProperty('role', 'reviewer');
    });

    it('should deny users without required permission', async () => {
      const { getUserById } = await import('~/lib/db/users.server');
      const mockGetUserById = getUserById as any;

      mockGetUserById.mockResolvedValue({
        id: 'user-1',
        role: 'viewer',
        email: 'viewer@test.com',
        name: 'Viewer User',
      });

      const middleware = requirePermission(Permission.APPROVE);
      const args = { request: mockRequest, context: mockContext, params: {} };

      // Mock requireAuth
      const { requireAuth } = await import('./session.server');
      const mockRequireAuth = requireAuth as any;
      mockRequireAuth.mockResolvedValue({
        id: 'user-1',
        username: 'viewer',
        email: 'viewer@test.com',
        name: 'Viewer User',
      });

      const result = await middleware(args);

      expect(result).toHaveProperty('status', 403);
      expect(result).toHaveProperty('requiredPermission', Permission.APPROVE);
    });
  });

  describe('checkCanApprove', () => {
    it('should correctly identify admin approval capability', async () => {
      const { getUserById } = await import('~/lib/db/users.server');
      const mockGetUserById = getUserById as any;

      mockGetUserById.mockResolvedValue({
        id: 'user-1',
        role: 'admin',
        email: 'admin@test.com',
        name: 'Admin User',
      });

      // Mock requireAuth
      const { requireAuth } = await import('./session.server');
      const mockRequireAuth = requireAuth as any;
      mockRequireAuth.mockResolvedValue({
        id: 'user-1',
        username: 'admin',
        email: 'admin@test.com',
        name: 'Admin User',
      });

      const result = await checkCanApprove(mockRequest, mockContext);

      expect(result.user).toHaveProperty('role', 'admin');
      expect(result.canApprove).toBe(true);
    });

    it('should correctly identify reviewer cannot approve', async () => {
      const { getUserById } = await import('~/lib/db/users.server');
      const mockGetUserById = getUserById as any;

      mockGetUserById.mockResolvedValue({
        id: 'user-1',
        role: 'reviewer',
        email: 'reviewer@test.com',
        name: 'Reviewer User',
      });

      // Mock requireAuth
      const { requireAuth } = await import('./session.server');
      const mockRequireAuth = requireAuth as any;
      mockRequireAuth.mockResolvedValue({
        id: 'user-1',
        username: 'reviewer',
        email: 'reviewer@test.com',
        name: 'Reviewer User',
      });

      const result = await checkCanApprove(mockRequest, mockContext);

      expect(result.user).toHaveProperty('role', 'reviewer');
      expect(result.canApprove).toBe(false);
    });
  });

  describe('checkCanManageUsers', () => {
    it('should allow admin to manage users', async () => {
      const { getUserById } = await import('~/lib/db/users.server');
      const mockGetUserById = getUserById as any;

      mockGetUserById.mockResolvedValue({
        id: 'user-1',
        role: 'admin',
        email: 'admin@test.com',
        name: 'Admin User',
      });

      // Mock requireAuth
      const { requireAuth } = await import('./session.server');
      const mockRequireAuth = requireAuth as any;
      mockRequireAuth.mockResolvedValue({
        id: 'user-1',
        username: 'admin',
        email: 'admin@test.com',
        name: 'Admin User',
      });

      const result = await checkCanManageUsers(mockRequest, mockContext);

      expect(result.user).toHaveProperty('role', 'admin');
      expect(result.canManage).toBe(true);
    });

    it('should deny non-admin from managing users', async () => {
      const { getUserById } = await import('~/lib/db/users.server');
      const mockGetUserById = getUserById as any;

      mockGetUserById.mockResolvedValue({
        id: 'user-1',
        role: 'reviewer',
        email: 'reviewer@test.com',
        name: 'Reviewer User',
      });

      // Mock requireAuth
      const { requireAuth } = await import('./session.server');
      const mockRequireAuth = requireAuth as any;
      mockRequireAuth.mockResolvedValue({
        id: 'user-1',
        username: 'reviewer',
        email: 'reviewer@test.com',
        name: 'Reviewer User',
      });

      const result = await checkCanManageUsers(mockRequest, mockContext);

      expect(result.user).toHaveProperty('role', 'reviewer');
      expect(result.canManage).toBe(false);
    });
  });
});
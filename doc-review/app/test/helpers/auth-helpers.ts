import { vi } from 'vitest';
import type { UserWithRole } from '~/lib/auth/permissions';
import type { OAuthUser } from '~/lib/auth/oauth.server';

/**
 * Test user roles (matching RBAC system)
 */
export type TestUserRole = 'viewer' | 'reviewer' | 'admin';

/**
 * Test user interface
 */
export interface TestUser {
  id: string;
  email: string;
  name: string;
  username?: string;
  avatarUrl?: string;
  role: TestUserRole;
}

/**
 * Create a test user with default values
 */
export function createTestUser(overrides: Partial<TestUser> = {}): TestUser {
  return {
    id: crypto.randomUUID(),
    email: 'test@example.com',
    name: 'Test User',
    username: 'testuser',
    avatarUrl: 'https://example.com/avatar.jpg',
    role: 'reviewer',
    ...overrides,
  };
}

/**
 * Create multiple test users with different roles
 */
export function createTestUsers(): {
  viewer: TestUser;
  reviewer: TestUser;
  admin: TestUser;
} {
  return {
    viewer: createTestUser({
      id: 'viewer-001',
      email: 'viewer@example.com',
      name: 'Viewer User',
      username: 'viewer',
      role: 'viewer',
    }),
    reviewer: createTestUser({
      id: 'reviewer-001',
      email: 'reviewer@example.com',
      name: 'Reviewer User',
      username: 'reviewer',
      role: 'reviewer',
    }),
    admin: createTestUser({
      id: 'admin-001',
      email: 'admin@example.com',
      name: 'Admin User',
      username: 'admin',
      role: 'admin',
    }),
  };
}

/**
 * Mock authentication to return a specific user
 * This mocks both session.server and middleware functions
 * Note: This function should be called after vi.mock() has been set up
 */
export async function mockAuth(user: TestUser | null = null) {
  const sessionModule = await import('~/lib/auth/session.server');
  const middlewareModule = await import('~/lib/auth/middleware');
  const usersModule = await import('~/lib/db/users.server');

  if (user === null) {
    // Mock unauthenticated request (throws error)
    vi.spyOn(sessionModule, 'requireAuth').mockRejectedValue(
      new Error('Unauthorized')
    );
    vi.spyOn(sessionModule, 'getUser').mockResolvedValue(null);
    vi.spyOn(middlewareModule, 'requireAuthWithRole').mockRejectedValue(
      new Error('Unauthorized')
    );
    vi.spyOn(middlewareModule, 'getUserWithRole').mockResolvedValue(null);
  } else {
    // Mock authenticated request
    const sessionUser: OAuthUser = {
      id: user.id,
      email: user.email,
      username: user.username ?? user.email.split('@')[0],
      name: user.name,
      avatarUrl: user.avatarUrl ?? '',
      provider: 'github',
      accessToken: 'mock-access-token',
      role: user.role,
    };

    const userWithRole: UserWithRole = {
      id: user.id,
      role: user.role,
      username: user.username,
      email: user.email,
      name: user.name,
    };

    // Mock session functions
    vi.spyOn(sessionModule, 'requireAuth').mockResolvedValue(sessionUser);
    vi.spyOn(sessionModule, 'getUser').mockResolvedValue(sessionUser);

    // Mock middleware functions (these are the actual ones used in routes)
    vi.spyOn(middlewareModule, 'requireAuthWithRole').mockResolvedValue(userWithRole);
    vi.spyOn(middlewareModule, 'getUserWithRole').mockResolvedValue(userWithRole);

    // Mock getUserById to return user with role
    vi.spyOn(usersModule, 'getUserById').mockResolvedValue({
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl ?? null,
      role: user.role,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  return { sessionModule, middlewareModule, usersModule };
}

/**
 * Mock authentication middleware for different scenarios
 */
export const mockAuthMiddleware = {
  /**
   * Mock successful authentication as viewer
   */
  asViewer: async () => {
    const user = createTestUser({ role: 'viewer' });
    await mockAuth(user);
    return user;
  },

  /**
   * Mock successful authentication as reviewer
   */
  asReviewer: async () => {
    const user = createTestUser({ role: 'reviewer' });
    await mockAuth(user);
    return user;
  },

  /**
   * Mock successful authentication as admin
   */
  asAdmin: async () => {
    const user = createTestUser({ role: 'admin' });
    await mockAuth(user);
    return user;
  },

  /**
   * Mock failed authentication (not logged in)
   */
  asUnauthenticated: async () => {
    await mockAuth(null);
    return null;
  },

  /**
   * Mock authentication as specific user
   */
  asUser: async (user: TestUser) => {
    await mockAuth(user);
    return user;
  },
};

/**
 * Create authorization test context
 * Tests common authorization scenarios for resource ownership
 */
export function createAuthTestContext(resourceOwnerId: string) {
  const users = createTestUsers();

  return {
    users,
    scenarios: {
      ownerAccess: {
        user: { ...users.reviewer, id: resourceOwnerId },
        shouldAllow: true,
        description: 'Resource owner should have access',
      },
      otherReviewerAccess: {
        user: users.reviewer,
        shouldAllow: false,
        description: 'Other reviewers should not have access to resources they do not own',
      },
      adminAccess: {
        user: users.admin,
        shouldAllow: true,
        description: 'Admins should have access to any resource',
      },
      viewerAccess: {
        user: users.viewer,
        shouldAllow: false,
        description: 'Viewers should not have write access',
      },
    },
  };
}

/**
 * Mock user sync to prevent database calls
 */
export async function mockUserSync() {
  const userModule = await import('~/lib/db/users.server');
  vi.spyOn(userModule, 'syncUserRecord').mockResolvedValue(null);
  return userModule;
}

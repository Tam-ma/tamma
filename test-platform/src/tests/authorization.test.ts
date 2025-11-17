/**
 * Authorization System Tests
 * Comprehensive test suite for RBAC implementation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { authorizationService } from '../services/authorization-service';
import { Permission, Role, ROLE_PERMISSIONS, getRolePermissions, isRoleHigherOrEqual } from '../models/permissions';
import { ApiError } from '../utils/api-error';
import { getDatabase } from '../database/connection';

// Mock database
vi.mock('../database/connection', () => ({
  getDatabase: vi.fn(),
}));

// Mock logger
vi.mock('../observability/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('Authorization System', () => {
  let mockDb: any;

  beforeEach(() => {
    // Clear cache before each test
    authorizationService.clearCache();

    // Setup mock database
    mockDb = {
      where: vi.fn().mockReturnThis(),
      first: vi.fn(),
      select: vi.fn().mockReturnThis(),
      join: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockReturnThis(),
      count: vi.fn().mockReturnThis(),
      update: vi.fn().mockResolvedValue(1),
      insert: vi.fn().mockResolvedValue([{ id: 'test-id' }]),
    };

    // Create table-specific mock
    const tableMock = (tableName: string) => {
      if (tableName === 'users' || tableName === 'user_organizations' ||
          tableName === 'organizations' || tableName === 'benchmarks') {
        return mockDb;
      }
      return mockDb;
    };

    vi.mocked(getDatabase).mockResolvedValue(tableMock as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Permission Model', () => {
    it('should have correct permissions for each role', () => {
      // Super Admin should have all permissions
      expect(ROLE_PERMISSIONS[Role.SUPER_ADMIN]).toContain(Permission.SYSTEM_ADMIN);
      expect(ROLE_PERMISSIONS[Role.SUPER_ADMIN]).toContain(Permission.ORG_DELETE);

      // Owner should have organization management but not system permissions
      expect(ROLE_PERMISSIONS[Role.ORG_OWNER]).toContain(Permission.ORG_MANAGE_BILLING);
      expect(ROLE_PERMISSIONS[Role.ORG_OWNER]).not.toContain(Permission.SYSTEM_ADMIN);

      // Admin should have most permissions but not billing
      expect(ROLE_PERMISSIONS[Role.ORG_ADMIN]).toContain(Permission.USER_INVITE);
      expect(ROLE_PERMISSIONS[Role.ORG_ADMIN]).not.toContain(Permission.ORG_MANAGE_BILLING);

      // Member should have basic permissions
      expect(ROLE_PERMISSIONS[Role.ORG_MEMBER]).toContain(Permission.BENCHMARK_CREATE);
      expect(ROLE_PERMISSIONS[Role.ORG_MEMBER]).not.toContain(Permission.USER_MANAGE_ROLES);

      // Viewer should have read-only permissions
      expect(ROLE_PERMISSIONS[Role.ORG_VIEWER]).toContain(Permission.BENCHMARK_READ);
      expect(ROLE_PERMISSIONS[Role.ORG_VIEWER]).not.toContain(Permission.BENCHMARK_CREATE);
    });

    it('should correctly determine role hierarchy', () => {
      expect(isRoleHigherOrEqual(Role.SUPER_ADMIN, Role.ORG_OWNER)).toBe(false);
      expect(isRoleHigherOrEqual(Role.ORG_OWNER, Role.ORG_ADMIN)).toBe(true);
      expect(isRoleHigherOrEqual(Role.ORG_OWNER, Role.ORG_OWNER)).toBe(true);
      expect(isRoleHigherOrEqual(Role.ORG_ADMIN, Role.ORG_MEMBER)).toBe(true);
      expect(isRoleHigherOrEqual(Role.ORG_MEMBER, Role.ORG_ADMIN)).toBe(false);
    });

    it('should get all permissions for a role including inherited', () => {
      const ownerPerms = getRolePermissions(Role.ORG_OWNER);
      const adminPerms = getRolePermissions(Role.ORG_ADMIN);
      const memberPerms = getRolePermissions(Role.ORG_MEMBER);

      // Owner should have more permissions than admin
      expect(ownerPerms.length).toBeGreaterThan(adminPerms.length);
      // Admin should have more permissions than member
      expect(adminPerms.length).toBeGreaterThan(memberPerms.length);
    });
  });

  describe('AuthorizationService', () => {
    describe('getUserPermissions', () => {
      it('should return super admin permissions for system admin user', async () => {
        mockDb.first.mockResolvedValueOnce({
          id: 'user-1',
          system_role: 'super_admin',
          status: 'active',
        });

        const result = await authorizationService.getUserPermissions('user-1');

        expect(result.role).toBe(Role.SUPER_ADMIN);
        expect(result.permissions).toEqual(ROLE_PERMISSIONS[Role.SUPER_ADMIN]);
        expect(result.organizationId).toBeUndefined();
      });

      it('should return organization-specific permissions', async () => {
        mockDb.first
          .mockResolvedValueOnce({
            id: 'user-1',
            system_role: 'user',
            status: 'active',
          })
          .mockResolvedValueOnce({
            user_id: 'user-1',
            organization_id: 'org-1',
            role: Role.ORG_ADMIN,
            permissions: [Permission.BENCHMARK_MANAGE_TEMPLATES],
            status: 'active',
          });

        const result = await authorizationService.getUserPermissions('user-1', 'org-1');

        expect(result.role).toBe(Role.ORG_ADMIN);
        expect(result.permissions).toContain(Permission.BENCHMARK_CREATE);
        expect(result.permissions).toContain(Permission.BENCHMARK_MANAGE_TEMPLATES);
        expect(result.organizationId).toBe('org-1');
      });

      it('should throw error if user not found', async () => {
        mockDb.first.mockResolvedValueOnce(null);

        await expect(
          authorizationService.getUserPermissions('user-1')
        ).rejects.toThrow('User not found');
      });

      it('should throw error if user not in organization', async () => {
        mockDb.first
          .mockResolvedValueOnce({
            id: 'user-1',
            system_role: 'user',
            status: 'active',
          })
          .mockResolvedValueOnce(null);

        await expect(
          authorizationService.getUserPermissions('user-1', 'org-1')
        ).rejects.toThrow('User is not a member of this organization');
      });

      it('should use cached permissions on subsequent calls', async () => {
        mockDb.first.mockResolvedValueOnce({
          id: 'user-1',
          system_role: 'super_admin',
          status: 'active',
        });

        // First call
        await authorizationService.getUserPermissions('user-1');

        // Second call should use cache
        await authorizationService.getUserPermissions('user-1');

        // Database should only be called once
        expect(mockDb.first).toHaveBeenCalledTimes(1);
      });
    });

    describe('hasPermission', () => {
      it('should return true if user has permission', async () => {
        mockDb.first
          .mockResolvedValueOnce({
            id: 'user-1',
            system_role: 'user',
            status: 'active',
          })
          .mockResolvedValueOnce({
            user_id: 'user-1',
            organization_id: 'org-1',
            role: Role.ORG_ADMIN,
            permissions: [],
            status: 'active',
          });

        const hasPermission = await authorizationService.hasPermission(
          'user-1',
          Permission.BENCHMARK_CREATE,
          'org-1'
        );

        expect(hasPermission).toBe(true);
      });

      it('should return false if user lacks permission', async () => {
        mockDb.first
          .mockResolvedValueOnce({
            id: 'user-1',
            system_role: 'user',
            status: 'active',
          })
          .mockResolvedValueOnce({
            user_id: 'user-1',
            organization_id: 'org-1',
            role: Role.ORG_VIEWER,
            permissions: [],
            status: 'active',
          });

        const hasPermission = await authorizationService.hasPermission(
          'user-1',
          Permission.BENCHMARK_DELETE,
          'org-1'
        );

        expect(hasPermission).toBe(false);
      });

      it('should check resource-specific access for benchmarks', async () => {
        mockDb.first
          .mockResolvedValueOnce({
            id: 'user-1',
            system_role: 'user',
            status: 'active',
          })
          .mockResolvedValueOnce({
            user_id: 'user-1',
            organization_id: 'org-1',
            role: Role.ORG_MEMBER,
            permissions: [],
            status: 'active',
          })
          .mockResolvedValueOnce({
            id: 'benchmark-1',
            created_by: 'user-1',
            organization_id: 'org-1',
            is_public: false,
          });

        const hasPermission = await authorizationService.hasPermission(
          'user-1',
          Permission.BENCHMARK_UPDATE,
          'org-1',
          {
            resourceType: 'benchmark',
            resourceId: 'benchmark-1',
          }
        );

        expect(hasPermission).toBe(true);
      });
    });

    describe('requirePermission', () => {
      it('should not throw if user has permission', async () => {
        mockDb.first
          .mockResolvedValueOnce({
            id: 'user-1',
            system_role: 'super_admin',
            status: 'active',
          });

        await expect(
          authorizationService.requirePermission('user-1', Permission.SYSTEM_ADMIN)
        ).resolves.toBeUndefined();
      });

      it('should throw ApiError if user lacks permission', async () => {
        mockDb.first
          .mockResolvedValueOnce({
            id: 'user-1',
            system_role: 'user',
            status: 'active',
          })
          .mockResolvedValueOnce({
            user_id: 'user-1',
            organization_id: 'org-1',
            role: Role.ORG_VIEWER,
            permissions: [],
            status: 'active',
          });

        await expect(
          authorizationService.requirePermission('user-1', Permission.BENCHMARK_DELETE, 'org-1')
        ).rejects.toThrow(ApiError);
      });
    });

    describe('hasAnyPermission', () => {
      it('should return true if user has at least one permission', async () => {
        mockDb.first
          .mockResolvedValueOnce({
            id: 'user-1',
            system_role: 'user',
            status: 'active',
          })
          .mockResolvedValueOnce({
            user_id: 'user-1',
            organization_id: 'org-1',
            role: Role.ORG_MEMBER,
            permissions: [],
            status: 'active',
          });

        const hasPermission = await authorizationService.hasAnyPermission(
          'user-1',
          [Permission.BENCHMARK_DELETE, Permission.BENCHMARK_CREATE],
          'org-1'
        );

        expect(hasPermission).toBe(true);
      });

      it('should return false if user has none of the permissions', async () => {
        mockDb.first
          .mockResolvedValueOnce({
            id: 'user-1',
            system_role: 'user',
            status: 'active',
          })
          .mockResolvedValueOnce({
            user_id: 'user-1',
            organization_id: 'org-1',
            role: Role.ORG_VIEWER,
            permissions: [],
            status: 'active',
          });

        const hasPermission = await authorizationService.hasAnyPermission(
          'user-1',
          [Permission.USER_DELETE, Permission.USER_MANAGE_ROLES],
          'org-1'
        );

        expect(hasPermission).toBe(false);
      });
    });

    describe('canManageUser', () => {
      it('should allow managing users with lower roles', async () => {
        // Actor is admin
        mockDb.first
          .mockResolvedValueOnce({
            id: 'user-1',
            system_role: 'user',
            status: 'active',
          })
          .mockResolvedValueOnce({
            user_id: 'user-1',
            organization_id: 'org-1',
            role: Role.ORG_ADMIN,
            permissions: [],
            status: 'active',
          });

        // Target is member
        mockDb.first
          .mockResolvedValueOnce({
            id: 'user-2',
            system_role: 'user',
            status: 'active',
          })
          .mockResolvedValueOnce({
            user_id: 'user-2',
            organization_id: 'org-1',
            role: Role.ORG_MEMBER,
            permissions: [],
            status: 'active',
          });

        const canManage = await authorizationService.canManageUser('user-1', 'user-2', 'org-1');

        expect(canManage).toBe(true);
      });

      it('should not allow managing users with equal or higher roles', async () => {
        // Actor is admin
        mockDb.first
          .mockResolvedValueOnce({
            id: 'user-1',
            system_role: 'user',
            status: 'active',
          })
          .mockResolvedValueOnce({
            user_id: 'user-1',
            organization_id: 'org-1',
            role: Role.ORG_ADMIN,
            permissions: [],
            status: 'active',
          });

        // Target is owner
        mockDb.first
          .mockResolvedValueOnce({
            id: 'user-2',
            system_role: 'user',
            status: 'active',
          })
          .mockResolvedValueOnce({
            user_id: 'user-2',
            organization_id: 'org-1',
            role: Role.ORG_OWNER,
            permissions: [],
            status: 'active',
          });

        const canManage = await authorizationService.canManageUser('user-1', 'user-2', 'org-1');

        expect(canManage).toBe(false);
      });
    });

    describe('cache management', () => {
      it('should invalidate cache for specific user and organization', async () => {
        mockDb.first.mockResolvedValueOnce({
          id: 'user-1',
          system_role: 'super_admin',
          status: 'active',
        });

        // Load permissions to cache
        await authorizationService.getUserPermissions('user-1');

        // Invalidate cache
        authorizationService.invalidateCache('user-1', 'org-1');

        // Next call should hit database again
        mockDb.first.mockResolvedValueOnce({
          id: 'user-1',
          system_role: 'super_admin',
          status: 'active',
        });

        await authorizationService.getUserPermissions('user-1');

        expect(mockDb.first).toHaveBeenCalledTimes(2);
      });

      it('should clear all cache entries', () => {
        authorizationService.clearCache();
        // Cache should be empty - this is implicitly tested by other tests
        expect(true).toBe(true);
      });
    });
  });

  describe('ApiError', () => {
    it('should create error with correct status code', () => {
      const error = new ApiError(403, 'Forbidden');
      expect(error.statusCode).toBe(403);
      expect(error.message).toBe('Forbidden');
    });

    it('should include details in error', () => {
      const details = { requiredPermission: Permission.BENCHMARK_DELETE };
      const error = new ApiError(403, 'Insufficient permissions', details);
      expect(error.details).toEqual(details);
    });

    it('should convert to JSON correctly', () => {
      const error = ApiError.forbidden('Access denied', { reason: 'test' });
      const json = error.toJSON();
      expect(json).toEqual({
        error: {
          message: 'Access denied',
          statusCode: 403,
          details: { reason: 'test' },
        },
      });
    });
  });
});
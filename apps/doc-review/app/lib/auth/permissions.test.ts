import { describe, it, expect, beforeEach } from 'vitest';
import {
  Permission,
  Role,
  hasPermission,
  hasAllPermissions,
  hasAnyPermission,
  requirePermission,
  hasMinimumRole,
  requireMinimumRole,
  canApprove,
  canManageUsers,
  canEditAny,
  canDeleteAny,
  canModifyResource,
  canDeleteResource,
  getMinimumRoleForPermission,
  getPermissionsForRole,
  isValidRole,
  normalizeRole,
  PermissionError,
  type UserWithRole,
} from './permissions';

describe('RBAC Permission System', () => {
  let viewerUser: UserWithRole;
  let reviewerUser: UserWithRole;
  let adminUser: UserWithRole;

  beforeEach(() => {
    viewerUser = {
      id: 'user-1',
      role: 'viewer',
      username: 'viewer',
      email: 'viewer@test.com',
      name: 'Viewer User',
    };

    reviewerUser = {
      id: 'user-2',
      role: 'reviewer',
      username: 'reviewer',
      email: 'reviewer@test.com',
      name: 'Reviewer User',
    };

    adminUser = {
      id: 'user-3',
      role: 'admin',
      username: 'admin',
      email: 'admin@test.com',
      name: 'Admin User',
    };
  });

  describe('hasPermission', () => {
    it('should grant correct permissions to viewer', () => {
      expect(hasPermission(viewerUser, Permission.READ)).toBe(true);
      expect(hasPermission(viewerUser, Permission.COMMENT)).toBe(false);
      expect(hasPermission(viewerUser, Permission.SUGGEST)).toBe(false);
      expect(hasPermission(viewerUser, Permission.APPROVE)).toBe(false);
      expect(hasPermission(viewerUser, Permission.ADMIN)).toBe(false);
    });

    it('should grant correct permissions to reviewer', () => {
      expect(hasPermission(reviewerUser, Permission.READ)).toBe(true);
      expect(hasPermission(reviewerUser, Permission.COMMENT)).toBe(true);
      expect(hasPermission(reviewerUser, Permission.SUGGEST)).toBe(true);
      expect(hasPermission(reviewerUser, Permission.APPROVE)).toBe(false);
      expect(hasPermission(reviewerUser, Permission.ADMIN)).toBe(false);
    });

    it('should grant all permissions to admin', () => {
      expect(hasPermission(adminUser, Permission.READ)).toBe(true);
      expect(hasPermission(adminUser, Permission.COMMENT)).toBe(true);
      expect(hasPermission(adminUser, Permission.SUGGEST)).toBe(true);
      expect(hasPermission(adminUser, Permission.APPROVE)).toBe(true);
      expect(hasPermission(adminUser, Permission.ADMIN)).toBe(true);
      expect(hasPermission(adminUser, Permission.MANAGE_USERS)).toBe(true);
      expect(hasPermission(adminUser, Permission.DELETE_ANY)).toBe(true);
      expect(hasPermission(adminUser, Permission.EDIT_ANY)).toBe(true);
    });

    it('should handle null or undefined users', () => {
      expect(hasPermission(null, Permission.READ)).toBe(false);
      expect(hasPermission(undefined, Permission.READ)).toBe(false);
    });

    it('should handle users without roles', () => {
      const userNoRole: UserWithRole = { ...viewerUser, role: undefined as any };
      expect(hasPermission(userNoRole, Permission.READ)).toBe(false);
    });

    it('should handle invalid roles', () => {
      const userBadRole: UserWithRole = { ...viewerUser, role: 'invalid' };
      expect(hasPermission(userBadRole, Permission.READ)).toBe(false);
    });
  });

  describe('hasAllPermissions', () => {
    it('should return true when user has all permissions', () => {
      expect(hasAllPermissions(reviewerUser, [Permission.READ, Permission.COMMENT])).toBe(true);
      expect(hasAllPermissions(adminUser, [Permission.APPROVE, Permission.ADMIN])).toBe(true);
    });

    it('should return false when user lacks any permission', () => {
      expect(hasAllPermissions(viewerUser, [Permission.READ, Permission.COMMENT])).toBe(false);
      expect(hasAllPermissions(reviewerUser, [Permission.COMMENT, Permission.APPROVE])).toBe(false);
    });

    it('should handle empty permission list', () => {
      expect(hasAllPermissions(viewerUser, [])).toBe(true);
    });
  });

  describe('hasAnyPermission', () => {
    it('should return true when user has at least one permission', () => {
      expect(hasAnyPermission(viewerUser, [Permission.READ, Permission.COMMENT])).toBe(true);
      expect(hasAnyPermission(reviewerUser, [Permission.APPROVE, Permission.COMMENT])).toBe(true);
    });

    it('should return false when user has none of the permissions', () => {
      expect(hasAnyPermission(viewerUser, [Permission.COMMENT, Permission.APPROVE])).toBe(false);
    });

    it('should handle empty permission list', () => {
      expect(hasAnyPermission(viewerUser, [])).toBe(false);
    });
  });

  describe('requirePermission', () => {
    it('should not throw when permission is granted', () => {
      expect(() => requirePermission(adminUser, Permission.APPROVE)).not.toThrow();
      expect(() => requirePermission(reviewerUser, Permission.COMMENT)).not.toThrow();
    });

    it('should throw PermissionError when permission is denied', () => {
      expect(() => requirePermission(viewerUser, Permission.COMMENT)).toThrow(PermissionError);
      expect(() => requirePermission(reviewerUser, Permission.APPROVE)).toThrow(PermissionError);
    });

    it('should include custom message in error', () => {
      const customMessage = 'Custom permission error';
      try {
        requirePermission(viewerUser, Permission.COMMENT, customMessage);
      } catch (error) {
        expect(error).toBeInstanceOf(PermissionError);
        expect((error as PermissionError).message).toBe(customMessage);
      }
    });
  });

  describe('hasMinimumRole', () => {
    it('should correctly check role hierarchy', () => {
      // Viewer
      expect(hasMinimumRole(viewerUser, Role.VIEWER)).toBe(true);
      expect(hasMinimumRole(viewerUser, Role.REVIEWER)).toBe(false);
      expect(hasMinimumRole(viewerUser, Role.ADMIN)).toBe(false);

      // Reviewer
      expect(hasMinimumRole(reviewerUser, Role.VIEWER)).toBe(true);
      expect(hasMinimumRole(reviewerUser, Role.REVIEWER)).toBe(true);
      expect(hasMinimumRole(reviewerUser, Role.ADMIN)).toBe(false);

      // Admin
      expect(hasMinimumRole(adminUser, Role.VIEWER)).toBe(true);
      expect(hasMinimumRole(adminUser, Role.REVIEWER)).toBe(true);
      expect(hasMinimumRole(adminUser, Role.ADMIN)).toBe(true);
    });

    it('should handle null or undefined users', () => {
      expect(hasMinimumRole(null, Role.VIEWER)).toBe(false);
      expect(hasMinimumRole(undefined, Role.ADMIN)).toBe(false);
    });
  });

  describe('requireMinimumRole', () => {
    it('should not throw when role requirement is met', () => {
      expect(() => requireMinimumRole(adminUser, Role.VIEWER)).not.toThrow();
      expect(() => requireMinimumRole(adminUser, Role.ADMIN)).not.toThrow();
    });

    it('should throw when role requirement is not met', () => {
      expect(() => requireMinimumRole(viewerUser, Role.REVIEWER)).toThrow(PermissionError);
      expect(() => requireMinimumRole(reviewerUser, Role.ADMIN)).toThrow(PermissionError);
    });
  });

  describe('Helper functions', () => {
    describe('canApprove', () => {
      it('should return true only for admins', () => {
        expect(canApprove(viewerUser)).toBe(false);
        expect(canApprove(reviewerUser)).toBe(false);
        expect(canApprove(adminUser)).toBe(true);
      });
    });

    describe('canManageUsers', () => {
      it('should return true only for admins', () => {
        expect(canManageUsers(viewerUser)).toBe(false);
        expect(canManageUsers(reviewerUser)).toBe(false);
        expect(canManageUsers(adminUser)).toBe(true);
      });
    });

    describe('canEditAny', () => {
      it('should return true only for admins', () => {
        expect(canEditAny(viewerUser)).toBe(false);
        expect(canEditAny(reviewerUser)).toBe(false);
        expect(canEditAny(adminUser)).toBe(true);
      });
    });

    describe('canDeleteAny', () => {
      it('should return true only for admins', () => {
        expect(canDeleteAny(viewerUser)).toBe(false);
        expect(canDeleteAny(reviewerUser)).toBe(false);
        expect(canDeleteAny(adminUser)).toBe(true);
      });
    });
  });

  describe('Resource ownership checks', () => {
    describe('canModifyResource', () => {
      it('should allow owner to modify their resource', () => {
        expect(canModifyResource(viewerUser, 'user-1')).toBe(true);
        expect(canModifyResource(reviewerUser, 'user-2')).toBe(true);
      });

      it('should not allow non-owner non-admin to modify resource', () => {
        expect(canModifyResource(viewerUser, 'user-2')).toBe(false);
        expect(canModifyResource(reviewerUser, 'user-1')).toBe(false);
      });

      it('should allow admin to modify any resource', () => {
        expect(canModifyResource(adminUser, 'user-1')).toBe(true);
        expect(canModifyResource(adminUser, 'user-2')).toBe(true);
        expect(canModifyResource(adminUser, 'random-id')).toBe(true);
      });

      it('should handle null users', () => {
        expect(canModifyResource(null, 'user-1')).toBe(false);
      });
    });

    describe('canDeleteResource', () => {
      it('should allow owner to delete their resource', () => {
        expect(canDeleteResource(viewerUser, 'user-1')).toBe(true);
        expect(canDeleteResource(reviewerUser, 'user-2')).toBe(true);
      });

      it('should not allow non-owner non-admin to delete resource', () => {
        expect(canDeleteResource(viewerUser, 'user-2')).toBe(false);
        expect(canDeleteResource(reviewerUser, 'user-1')).toBe(false);
      });

      it('should allow admin to delete any resource', () => {
        expect(canDeleteResource(adminUser, 'user-1')).toBe(true);
        expect(canDeleteResource(adminUser, 'user-2')).toBe(true);
        expect(canDeleteResource(adminUser, 'random-id')).toBe(true);
      });
    });
  });

  describe('Utility functions', () => {
    describe('getMinimumRoleForPermission', () => {
      it('should return correct minimum role for permissions', () => {
        expect(getMinimumRoleForPermission(Permission.READ)).toBe(Role.VIEWER);
        expect(getMinimumRoleForPermission(Permission.COMMENT)).toBe(Role.REVIEWER);
        expect(getMinimumRoleForPermission(Permission.SUGGEST)).toBe(Role.REVIEWER);
        expect(getMinimumRoleForPermission(Permission.APPROVE)).toBe(Role.ADMIN);
        expect(getMinimumRoleForPermission(Permission.MANAGE_USERS)).toBe(Role.ADMIN);
      });
    });

    describe('getPermissionsForRole', () => {
      it('should return correct permissions for each role', () => {
        const viewerPerms = getPermissionsForRole(Role.VIEWER);
        expect(viewerPerms).toContain(Permission.READ);
        expect(viewerPerms).toHaveLength(1);

        const reviewerPerms = getPermissionsForRole(Role.REVIEWER);
        expect(reviewerPerms).toContain(Permission.READ);
        expect(reviewerPerms).toContain(Permission.COMMENT);
        expect(reviewerPerms).toContain(Permission.SUGGEST);
        expect(reviewerPerms).toHaveLength(3);

        const adminPerms = getPermissionsForRole(Role.ADMIN);
        expect(adminPerms).toContain(Permission.READ);
        expect(adminPerms).toContain(Permission.COMMENT);
        expect(adminPerms).toContain(Permission.SUGGEST);
        expect(adminPerms).toContain(Permission.APPROVE);
        expect(adminPerms).toContain(Permission.ADMIN);
        expect(adminPerms).toContain(Permission.MANAGE_USERS);
        expect(adminPerms.length).toBeGreaterThan(5);
      });
    });

    describe('isValidRole', () => {
      it('should validate roles correctly', () => {
        expect(isValidRole('viewer')).toBe(true);
        expect(isValidRole('reviewer')).toBe(true);
        expect(isValidRole('admin')).toBe(true);
        expect(isValidRole('VIEWER')).toBe(true);
        expect(isValidRole('Admin')).toBe(true);
        expect(isValidRole('invalid')).toBe(false);
        expect(isValidRole('superadmin')).toBe(false);
        expect(isValidRole('')).toBe(false);
      });
    });

    describe('normalizeRole', () => {
      it('should normalize valid roles', () => {
        expect(normalizeRole('VIEWER')).toBe(Role.VIEWER);
        expect(normalizeRole('Reviewer')).toBe(Role.REVIEWER);
        expect(normalizeRole('ADMIN')).toBe(Role.ADMIN);
      });

      it('should throw for invalid roles', () => {
        expect(() => normalizeRole('invalid')).toThrow('Invalid role: invalid');
        expect(() => normalizeRole('')).toThrow();
      });
    });
  });

  describe('PermissionError', () => {
    it('should create error with required properties', () => {
      const error = new PermissionError(
        'Test error',
        Permission.APPROVE,
        'reviewer',
        Role.ADMIN
      );

      expect(error.message).toBe('Test error');
      expect(error.name).toBe('PermissionError');
      expect(error.requiredPermission).toBe(Permission.APPROVE);
      expect(error.userRole).toBe('reviewer');
      expect(error.requiredRole).toBe(Role.ADMIN);
    });
  });

  describe('Edge cases', () => {
    it('should handle case-insensitive roles', () => {
      const upperViewer: UserWithRole = { ...viewerUser, role: 'VIEWER' };
      const mixedAdmin: UserWithRole = { ...adminUser, role: 'AdMiN' };

      expect(hasPermission(upperViewer, Permission.READ)).toBe(true);
      expect(hasPermission(mixedAdmin, Permission.ADMIN)).toBe(true);
    });

    it('should handle whitespace in roles', () => {
      const spacedRole: UserWithRole = { ...viewerUser, role: ' viewer ' };
      // This would fail as we don't trim - intentional to enforce clean data
      expect(hasPermission(spacedRole, Permission.READ)).toBe(false);
    });
  });
});
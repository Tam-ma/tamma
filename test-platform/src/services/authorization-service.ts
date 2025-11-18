/**
 * Authorization Service for managing permissions and access control
 * Implements RBAC with organization-scoped permissions and caching
 */

import {
  Permission,
  Role,
  ROLE_PERMISSIONS,
  PermissionContext,
  ResourceContext,
  getRolePermissions,
  isRoleHigherOrEqual,
} from '../models/permissions';
import { getDatabase } from '../database/connection';
import { logger } from '../observability/logger';
import { ApiError } from '../utils/api-error';
import { Knex } from 'knex';

// Cache configuration
const PERMISSION_CACHE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds

interface CachedPermissions {
  role: Role;
  permissions: Permission[];
  organizationId?: string;
  cachedAt: number;
}

export class AuthorizationService {
  private permissionCache: Map<string, CachedPermissions> = new Map();

  /**
   * Get user permissions with caching support
   */
  async getUserPermissions(
    userId: string,
    organizationId?: string
  ): Promise<{
    role: Role;
    permissions: Permission[];
    organizationId?: string;
  }> {
    try {
      // Check cache first
      const cacheKey = `${userId}:${organizationId || 'system'}`;
      const cached = this.getFromCache(cacheKey);
      if (cached) {
        return cached;
      }

      const db = await getDatabase();

      // Get user's system role
      const user = await db('users')
        .where('id', userId)
        .where('status', 'active')
        .first();

      if (!user) {
        throw ApiError.notFound('User not found');
      }

      // Super admin has all permissions system-wide
      if (user.system_role === 'super_admin') {
        const result = {
          role: Role.SUPER_ADMIN,
          permissions: ROLE_PERMISSIONS[Role.SUPER_ADMIN],
        };
        this.setCache(cacheKey, result);
        return result;
      }

      // If no organization context, return minimal permissions
      if (!organizationId) {
        const result = {
          role: Role.ORG_VIEWER,
          permissions: [],
        };
        return result;
      }

      // Get user's organization role
      const userOrg = await db('user_organizations')
        .where('user_id', userId)
        .where('organization_id', organizationId)
        .where('status', 'active')
        .first();

      if (!userOrg) {
        throw ApiError.forbidden('User is not a member of this organization');
      }

      const role = userOrg.role as Role;
      const basePermissions = getRolePermissions(role);

      // Add any custom permissions from the user_organization record
      const customPermissions: Permission[] = userOrg.permissions || [];
      const allPermissions = [...new Set([...basePermissions, ...customPermissions])];

      const result = {
        role,
        permissions: allPermissions,
        organizationId,
      };

      this.setCache(cacheKey, result);
      return result;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      logger.error('Failed to get user permissions', { error, userId, organizationId });
      throw ApiError.internalServerError('Failed to get user permissions');
    }
  }

  /**
   * Check if user has a specific permission
   */
  async hasPermission(
    userId: string,
    permission: Permission,
    organizationId?: string,
    resourceContext?: ResourceContext
  ): Promise<boolean> {
    try {
      const userPermissions = await this.getUserPermissions(userId, organizationId);

      // Check if user has the required permission
      if (!userPermissions.permissions.includes(permission)) {
        return false;
      }

      // Additional resource-specific checks
      if (resourceContext) {
        return await this.checkResourceAccess(userId, userPermissions, resourceContext);
      }

      return true;
    } catch (error) {
      logger.error('Permission check failed', { error, userId, permission, organizationId });
      return false;
    }
  }

  /**
   * Require user to have a specific permission (throws if not)
   */
  async requirePermission(
    userId: string,
    permission: Permission,
    organizationId?: string,
    resourceContext?: ResourceContext
  ): Promise<void> {
    const hasPermission = await this.hasPermission(
      userId,
      permission,
      organizationId,
      resourceContext
    );

    if (!hasPermission) {
      throw ApiError.forbidden('Insufficient permissions', {
        requiredPermission: permission,
        organizationId,
        resourceType: resourceContext?.resourceType,
      });
    }
  }

  /**
   * Check if user has any of the specified permissions
   */
  async hasAnyPermission(
    userId: string,
    permissions: Permission[],
    organizationId?: string,
    resourceContext?: ResourceContext
  ): Promise<boolean> {
    for (const permission of permissions) {
      if (await this.hasPermission(userId, permission, organizationId, resourceContext)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Require user to have at least one of the specified permissions
   */
  async requireAnyPermission(
    userId: string,
    permissions: Permission[],
    organizationId?: string,
    resourceContext?: ResourceContext
  ): Promise<void> {
    const hasPermission = await this.hasAnyPermission(
      userId,
      permissions,
      organizationId,
      resourceContext
    );

    if (!hasPermission) {
      throw ApiError.forbidden('Insufficient permissions', {
        requiredPermissions: permissions,
        organizationId,
        resourceType: resourceContext?.resourceType,
      });
    }
  }

  /**
   * Check if user has all specified permissions
   */
  async hasAllPermissions(
    userId: string,
    permissions: Permission[],
    organizationId?: string,
    resourceContext?: ResourceContext
  ): Promise<boolean> {
    for (const permission of permissions) {
      if (!(await this.hasPermission(userId, permission, organizationId, resourceContext))) {
        return false;
      }
    }
    return true;
  }

  /**
   * Require user to have all specified permissions
   */
  async requireAllPermissions(
    userId: string,
    permissions: Permission[],
    organizationId?: string,
    resourceContext?: ResourceContext
  ): Promise<void> {
    const hasPermission = await this.hasAllPermissions(
      userId,
      permissions,
      organizationId,
      resourceContext
    );

    if (!hasPermission) {
      throw ApiError.forbidden('Insufficient permissions', {
        requiredPermissions: permissions,
        organizationId,
        resourceType: resourceContext?.resourceType,
      });
    }
  }

  /**
   * Check if user can perform an action on another user
   */
  async canManageUser(
    actorId: string,
    targetUserId: string,
    organizationId: string
  ): Promise<boolean> {
    try {
      const actorPerms = await this.getUserPermissions(actorId, organizationId);
      const targetPerms = await this.getUserPermissions(targetUserId, organizationId);

      // Can't manage users with higher or equal roles
      if (!isRoleHigherOrEqual(actorPerms.role, targetPerms.role)) {
        return false;
      }

      // Must have user management permission
      return actorPerms.permissions.includes(Permission.USER_MANAGE_ROLES);
    } catch (error) {
      logger.error('Failed to check user management permission', { error, actorId, targetUserId });
      return false;
    }
  }

  /**
   * Invalidate permission cache for a user
   */
  invalidateCache(userId: string, organizationId?: string): void {
    const cacheKey = organizationId ? `${userId}:${organizationId}` : `${userId}:*`;

    if (organizationId) {
      this.permissionCache.delete(cacheKey);
    } else {
      // Clear all cache entries for the user
      const keysToDelete: string[] = [];
      for (const key of this.permissionCache.keys()) {
        if (key.startsWith(`${userId}:`)) {
          keysToDelete.push(key);
        }
      }
      keysToDelete.forEach(key => this.permissionCache.delete(key));
    }
  }

  /**
   * Clear all permission cache
   */
  clearCache(): void {
    this.permissionCache.clear();
  }

  /**
   * Private: Check resource-specific access
   */
  private async checkResourceAccess(
    userId: string,
    userPermissions: { role: Role; permissions: Permission[]; organizationId?: string },
    resourceContext: ResourceContext
  ): Promise<boolean> {
    try {
      const db = await getDatabase();

      switch (resourceContext.resourceType) {
        case 'benchmark':
          return await this.checkBenchmarkAccess(db, userId, userPermissions, resourceContext);
        case 'api_key':
          return await this.checkApiKeyAccess(db, userId, userPermissions, resourceContext);
        case 'user':
          return await this.checkUserAccess(db, userId, userPermissions, resourceContext);
        case 'organization':
          return await this.checkOrganizationAccess(db, userId, userPermissions, resourceContext);
        case 'report':
          return await this.checkReportAccess(db, userId, userPermissions, resourceContext);
        case 'workspace':
          return await this.checkWorkspaceAccess(db, userId, userPermissions, resourceContext);
        case 'data':
          return await this.checkDataAccess(db, userId, userPermissions, resourceContext);
        default:
          return true; // No additional checks for unknown resource types
      }
    } catch (error) {
      logger.error('Resource access check failed', { error, userId, resourceContext });
      return false;
    }
  }

  private async checkBenchmarkAccess(
    db: Knex,
    userId: string,
    userPermissions: { role: Role; permissions: Permission[] },
    resourceContext: ResourceContext
  ): Promise<boolean> {
    if (!resourceContext.resourceId) {
      return true;
    }

    // Get benchmark owner
    const benchmark = await db('benchmarks')
      .where('id', resourceContext.resourceId)
      .first();

    if (!benchmark) {
      return false;
    }

    // Owner can always access their own benchmarks
    if (benchmark.created_by === userId) {
      return true;
    }

    // Check if benchmark is public
    if (benchmark.is_public) {
      return true;
    }

    // Otherwise, check organization permissions
    return userPermissions.organizationId === benchmark.organization_id;
  }

  private async checkApiKeyAccess(
    db: Knex,
    userId: string,
    userPermissions: { role: Role; permissions: Permission[] },
    resourceContext: ResourceContext
  ): Promise<boolean> {
    if (!resourceContext.resourceId) {
      return true;
    }

    // Get API key owner
    const apiKey = await db('api_keys')
      .where('id', resourceContext.resourceId)
      .first();

    if (!apiKey) {
      return false;
    }

    // Owner can always access their own API keys
    if (apiKey.user_id === userId) {
      return true;
    }

    // Admins and owners can manage organization API keys
    if ([Role.ORG_OWNER, Role.ORG_ADMIN].includes(userPermissions.role)) {
      return apiKey.organization_id === userPermissions.organizationId;
    }

    return false;
  }

  private async checkUserAccess(
    db: Knex,
    userId: string,
    userPermissions: { role: Role; permissions: Permission[] },
    resourceContext: ResourceContext
  ): Promise<boolean> {
    if (!resourceContext.resourceId) {
      return true;
    }

    // Users can always access their own profile
    if (resourceContext.resourceId === userId) {
      return true;
    }

    // Must have user read permission
    if (!userPermissions.permissions.includes(Permission.USER_READ)) {
      return false;
    }

    // Check if target user is in the same organization
    if (userPermissions.organizationId) {
      const targetUserOrg = await db('user_organizations')
        .where('user_id', resourceContext.resourceId)
        .where('organization_id', userPermissions.organizationId)
        .first();

      return !!targetUserOrg;
    }

    return false;
  }

  private async checkOrganizationAccess(
    db: Knex,
    userId: string,
    userPermissions: { role: Role; permissions: Permission[] },
    resourceContext: ResourceContext
  ): Promise<boolean> {
    if (!resourceContext.resourceId) {
      return true;
    }

    // Check if user is member of the organization
    const userOrg = await db('user_organizations')
      .where('user_id', userId)
      .where('organization_id', resourceContext.resourceId)
      .where('status', 'active')
      .first();

    return !!userOrg;
  }

  private async checkReportAccess(
    db: Knex,
    userId: string,
    userPermissions: { role: Role; permissions: Permission[] },
    resourceContext: ResourceContext
  ): Promise<boolean> {
    if (!resourceContext.resourceId) {
      return true;
    }

    // Get report details
    const report = await db('reports')
      .where('id', resourceContext.resourceId)
      .first();

    if (!report) {
      return false;
    }

    // Owner can always access
    if (report.created_by === userId) {
      return true;
    }

    // Check if report is shared
    if (report.is_shared) {
      return userPermissions.organizationId === report.organization_id;
    }

    return false;
  }

  private async checkWorkspaceAccess(
    db: Knex,
    userId: string,
    userPermissions: { role: Role; permissions: Permission[] },
    resourceContext: ResourceContext
  ): Promise<boolean> {
    if (!resourceContext.resourceId) {
      return true;
    }

    // Check workspace membership
    const workspaceMember = await db('workspace_members')
      .where('workspace_id', resourceContext.resourceId)
      .where('user_id', userId)
      .where('status', 'active')
      .first();

    return !!workspaceMember;
  }

  private async checkDataAccess(
    db: Knex,
    userId: string,
    userPermissions: { role: Role; permissions: Permission[] },
    resourceContext: ResourceContext
  ): Promise<boolean> {
    if (!resourceContext.resourceId) {
      return true;
    }

    // Get data details
    const data = await db('data_files')
      .where('id', resourceContext.resourceId)
      .first();

    if (!data) {
      return false;
    }

    // Owner can always access
    if (data.uploaded_by === userId) {
      return true;
    }

    // Check organization access
    return userPermissions.organizationId === data.organization_id;
  }

  /**
   * Private: Cache management helpers
   */
  private getFromCache(key: string): CachedPermissions | null {
    const cached = this.permissionCache.get(key);
    if (!cached) {
      return null;
    }

    // Check if cache is expired
    if (Date.now() - cached.cachedAt > PERMISSION_CACHE_TTL) {
      this.permissionCache.delete(key);
      return null;
    }

    return cached;
  }

  private setCache(key: string, data: Omit<CachedPermissions, 'cachedAt'>): void {
    this.permissionCache.set(key, {
      ...data,
      cachedAt: Date.now(),
    });
  }
}

// Export singleton instance
export const authorizationService = new AuthorizationService();
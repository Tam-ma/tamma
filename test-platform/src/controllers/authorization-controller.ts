/**
 * Authorization Controller for managing roles and permissions
 * Provides endpoints for role assignment, permission management, and access control
 */

import { Request, Response, NextFunction } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { authorizationService } from '../services/authorization-service';
import { Role, Permission, PERMISSION_GROUPS, isRoleHigherOrEqual } from '../models/permissions';
import { logger } from '../observability/logger';
import { ApiError } from '../utils/api-error';
import { getDatabase } from '../database/connection';

export class AuthorizationController {
  /**
   * Validation rules
   */
  static assignRoleValidation = [
    param('userId').isUUID().withMessage('Valid user ID is required'),
    param('organizationId').isUUID().withMessage('Valid organization ID is required'),
    body('role').isIn(Object.values(Role)).withMessage('Valid role is required'),
    body('permissions')
      .optional()
      .isArray()
      .withMessage('Permissions must be an array'),
    body('permissions.*')
      .optional()
      .isIn(Object.values(Permission))
      .withMessage('Each permission must be valid'),
  ];

  static getUserPermissionsValidation = [
    param('userId').isUUID().withMessage('Valid user ID is required'),
    query('organizationId').optional().isUUID().withMessage('Valid organization ID is required'),
  ];

  static getOrganizationMembersValidation = [
    param('organizationId').isUUID().withMessage('Valid organization ID is required'),
    query('role').optional().isIn(Object.values(Role)).withMessage('Valid role filter'),
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  ];

  static removeUserValidation = [
    param('userId').isUUID().withMessage('Valid user ID is required'),
    param('organizationId').isUUID().withMessage('Valid organization ID is required'),
  ];

  /**
   * Assign or update a user's role in an organization
   */
  async assignRole(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // Check validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw ApiError.badRequest('Validation failed', errors.array());
      }

      const { userId, organizationId } = req.params;
      const { role, permissions } = req.body;
      const currentUserId = req.user!.sub;

      // Check if current user can manage roles in this organization
      await authorizationService.requirePermission(
        currentUserId,
        Permission.USER_MANAGE_ROLES,
        organizationId
      );

      // Check if current user can assign this specific role
      const canAssign = await authorizationService.canManageUser(
        currentUserId,
        userId,
        organizationId
      );

      if (!canAssign) {
        throw ApiError.forbidden('Cannot assign role to user with equal or higher privileges');
      }

      // Update user's role in organization
      await this.updateUserRole(userId, organizationId, role, permissions);

      // Invalidate cache for the user
      authorizationService.invalidateCache(userId, organizationId);

      // Log the action
      await this.logAuditEvent('USER_ROLE_ASSIGNED', {
        userId,
        organizationId,
        role,
        permissions,
        assignedBy: currentUserId,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
      });

      logger.info('User role assigned', {
        userId,
        organizationId,
        role,
        assignedBy: currentUserId,
      });

      res.json({
        success: true,
        message: 'Role assigned successfully',
        data: {
          userId,
          organizationId,
          role,
          permissions,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get user's permissions in an organization or system-wide
   */
  async getUserPermissions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // Check validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw ApiError.badRequest('Validation failed', errors.array());
      }

      const { userId } = req.params;
      const { organizationId } = req.query;
      const currentUserId = req.user!.sub;

      // Users can view their own permissions, others need USER_READ permission
      if (userId !== currentUserId) {
        if (organizationId) {
          await authorizationService.requirePermission(
            currentUserId,
            Permission.USER_READ,
            organizationId as string
          );
        } else {
          await authorizationService.requirePermission(
            currentUserId,
            Permission.SYSTEM_USER_MANAGEMENT
          );
        }
      }

      const userPermissions = await authorizationService.getUserPermissions(
        userId,
        organizationId as string
      );

      res.json({
        success: true,
        data: {
          userId,
          organizationId,
          role: userPermissions.role,
          permissions: userPermissions.permissions,
          permissionGroups: this.groupPermissions(userPermissions.permissions),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get all available roles and their permissions
   */
  async getRoles(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const roles = Object.values(Role).map(role => ({
        role,
        name: this.getRoleName(role),
        description: this.getRoleDescription(role),
        permissions: PERMISSION_GROUPS,
      }));

      res.json({
        success: true,
        data: roles,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get organization members with their roles
   */
  async getOrganizationMembers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // Check validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw ApiError.badRequest('Validation failed', errors.array());
      }

      const { organizationId } = req.params;
      const { role, page = 1, limit = 20 } = req.query;
      const currentUserId = req.user!.sub;

      // Check if user can read organization members
      await authorizationService.requirePermission(
        currentUserId,
        Permission.USER_READ,
        organizationId
      );

      const members = await this.getOrganizationMembersList(
        organizationId,
        role as Role | undefined,
        Number(page),
        Number(limit)
      );

      res.json({
        success: true,
        data: {
          organizationId,
          members: members.data,
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total: members.total,
            pages: Math.ceil(members.total / Number(limit)),
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Remove a user from an organization
   */
  async removeUserFromOrganization(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // Check validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw ApiError.badRequest('Validation failed', errors.array());
      }

      const { userId, organizationId } = req.params;
      const currentUserId = req.user!.sub;

      // Check if current user can remove users from organization
      await authorizationService.requirePermission(
        currentUserId,
        Permission.USER_DEACTIVATE,
        organizationId
      );

      // Check if user can manage the target user
      const canManage = await authorizationService.canManageUser(
        currentUserId,
        userId,
        organizationId
      );

      if (!canManage) {
        throw ApiError.forbidden('Cannot remove user with equal or higher privileges');
      }

      // Prevent removing the last owner
      const isLastOwner = await this.isLastOwner(userId, organizationId);
      if (isLastOwner) {
        throw ApiError.badRequest('Cannot remove the last owner of the organization');
      }

      // Remove user from organization
      await this.removeUserFromOrg(userId, organizationId);

      // Invalidate cache for the user
      authorizationService.invalidateCache(userId, organizationId);

      // Log the action
      await this.logAuditEvent('USER_REMOVED_FROM_ORGANIZATION', {
        userId,
        organizationId,
        removedBy: currentUserId,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
      });

      logger.info('User removed from organization', {
        userId,
        organizationId,
        removedBy: currentUserId,
      });

      res.json({
        success: true,
        message: 'User removed from organization successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Check user's permission for a specific action
   */
  async checkPermission(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { permission, organizationId } = req.body;
      const userId = req.user!.sub;

      if (!permission || !Object.values(Permission).includes(permission)) {
        throw ApiError.badRequest('Valid permission is required');
      }

      const hasPermission = await authorizationService.hasPermission(
        userId,
        permission,
        organizationId
      );

      res.json({
        success: true,
        data: {
          hasPermission,
          permission,
          organizationId,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Private helper methods
   */

  private async updateUserRole(
    userId: string,
    organizationId: string,
    role: Role,
    permissions?: Permission[]
  ): Promise<void> {
    const db = await getDatabase();
    await db('user_organizations')
      .where('user_id', userId)
      .where('organization_id', organizationId)
      .update({
        role,
        permissions: permissions || [],
        updated_at: new Date(),
      });
  }

  private async getOrganizationMembersList(
    organizationId: string,
    roleFilter?: Role,
    page: number = 1,
    limit: number = 20
  ): Promise<{ data: any[]; total: number }> {
    const db = await getDatabase();
    const offset = (page - 1) * limit;

    let query = db('user_organizations')
      .join('users', 'user_organizations.user_id', 'users.id')
      .where('user_organizations.organization_id', organizationId)
      .where('user_organizations.status', 'active');

    if (roleFilter) {
      query = query.where('user_organizations.role', roleFilter);
    }

    const [data, [{ count }]] = await Promise.all([
      query
        .select([
          'users.id',
          'users.email',
          'users.first_name',
          'users.last_name',
          'users.status as user_status',
          'users.created_at as user_created_at',
          'user_organizations.role',
          'user_organizations.permissions',
          'user_organizations.joined_at',
          'user_organizations.status as membership_status',
        ])
        .orderBy('user_organizations.joined_at', 'asc')
        .limit(limit)
        .offset(offset),
      query.clone().count('* as count'),
    ]);

    return {
      data,
      total: Number(count),
    };
  }

  private async removeUserFromOrg(userId: string, organizationId: string): Promise<void> {
    const db = await getDatabase();
    await db('user_organizations')
      .where('user_id', userId)
      .where('organization_id', organizationId)
      .update({
        status: 'left',
        left_at: new Date(),
        updated_at: new Date(),
      });
  }

  private async isLastOwner(userId: string, organizationId: string): Promise<boolean> {
    const db = await getDatabase();
    const owners = await db('user_organizations')
      .where('organization_id', organizationId)
      .where('role', Role.ORG_OWNER)
      .where('status', 'active')
      .count('* as count')
      .first();

    const userRole = await db('user_organizations')
      .where('user_id', userId)
      .where('organization_id', organizationId)
      .where('status', 'active')
      .select('role')
      .first();

    return userRole?.role === Role.ORG_OWNER && Number(owners?.count) === 1;
  }

  private async logAuditEvent(eventType: string, data: any): Promise<void> {
    try {
      const db = await getDatabase();
      await db('events').insert({
        event_type: eventType,
        event_data: JSON.stringify(data),
        user_id: data.assignedBy || data.removedBy,
        organization_id: data.organizationId,
        ip_address: data.ipAddress,
        user_agent: data.userAgent,
        created_at: new Date(),
      });
    } catch (error) {
      logger.error('Failed to log audit event', { error, eventType, data });
    }
  }

  private groupPermissions(permissions: Permission[]): Record<string, Permission[]> {
    const grouped: Record<string, Permission[]> = {};

    for (const [group, groupPerms] of Object.entries(PERMISSION_GROUPS)) {
      const userPerms = groupPerms.filter(p => permissions.includes(p));
      if (userPerms.length > 0) {
        grouped[group] = userPerms;
      }
    }

    return grouped;
  }

  private getRoleName(role: Role): string {
    const names: Record<Role, string> = {
      [Role.SUPER_ADMIN]: 'Super Administrator',
      [Role.ORG_OWNER]: 'Organization Owner',
      [Role.ORG_ADMIN]: 'Organization Administrator',
      [Role.ORG_MEMBER]: 'Organization Member',
      [Role.ORG_VIEWER]: 'Organization Viewer',
    };
    return names[role];
  }

  private getRoleDescription(role: Role): string {
    const descriptions: Record<Role, string> = {
      [Role.SUPER_ADMIN]: 'Full system access with all permissions',
      [Role.ORG_OWNER]: 'Full control over the organization and its resources',
      [Role.ORG_ADMIN]: 'Manage organization resources and members',
      [Role.ORG_MEMBER]: 'Create and manage own resources within the organization',
      [Role.ORG_VIEWER]: 'Read-only access to organization resources',
    };
    return descriptions[role];
  }
}

// Export singleton instance
export const authorizationController = new AuthorizationController();
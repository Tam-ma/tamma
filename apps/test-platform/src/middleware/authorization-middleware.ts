/**
 * Authorization Middleware for request handling
 * Provides decorators and middleware functions for permission checking
 */

import { Request, Response, NextFunction } from 'express';
import { authorizationService } from '../services/authorization-service';
import { Permission, Role, ResourceContext } from '../models/permissions';
import { ApiError } from '../utils/api-error';
import { logger } from '../observability/logger';
import { getDatabase } from '../database/connection';

// Extend Express Request to include user data
declare global {
  namespace Express {
    interface Request {
      user?: {
        sub: string;
        email: string;
        organizationId?: string;
        role?: Role;
        permissions?: Permission[];
      };
      organization?: {
        id: string;
        name: string;
        slug: string;
      };
    }
  }
}

export class AuthorizationMiddleware {
  /**
   * Middleware to check if user has a specific permission
   */
  static requirePermission(
    permission: Permission,
    getOrganizationId?: (req: Request) => string | undefined
  ) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const userId = req.user?.sub;
        if (!userId) {
          throw ApiError.unauthorized('Authentication required');
        }

        const organizationId = getOrganizationId
          ? getOrganizationId(req)
          : req.params.organizationId || req.query.organizationId as string || req.user?.organizationId;

        await authorizationService.requirePermission(userId, permission, organizationId);

        next();
      } catch (error) {
        if (error instanceof ApiError) {
          res.status(error.statusCode).json(error.toJSON());
        } else {
          logger.error('Authorization check failed', { error });
          res.status(500).json({ error: { message: 'Authorization check failed' } });
        }
      }
    };
  }

  /**
   * Middleware to check if user has any of the specified permissions
   */
  static requireAnyPermission(
    permissions: Permission[],
    getOrganizationId?: (req: Request) => string | undefined
  ) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const userId = req.user?.sub;
        if (!userId) {
          throw ApiError.unauthorized('Authentication required');
        }

        const organizationId = getOrganizationId
          ? getOrganizationId(req)
          : req.params.organizationId || req.query.organizationId as string || req.user?.organizationId;

        await authorizationService.requireAnyPermission(userId, permissions, organizationId);

        next();
      } catch (error) {
        if (error instanceof ApiError) {
          res.status(error.statusCode).json(error.toJSON());
        } else {
          logger.error('Authorization check failed', { error });
          res.status(500).json({ error: { message: 'Authorization check failed' } });
        }
      }
    };
  }

  /**
   * Middleware to check if user has all specified permissions
   */
  static requireAllPermissions(
    permissions: Permission[],
    getOrganizationId?: (req: Request) => string | undefined
  ) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const userId = req.user?.sub;
        if (!userId) {
          throw ApiError.unauthorized('Authentication required');
        }

        const organizationId = getOrganizationId
          ? getOrganizationId(req)
          : req.params.organizationId || req.query.organizationId as string || req.user?.organizationId;

        await authorizationService.requireAllPermissions(userId, permissions, organizationId);

        next();
      } catch (error) {
        if (error instanceof ApiError) {
          res.status(error.statusCode).json(error.toJSON());
        } else {
          logger.error('Authorization check failed', { error });
          res.status(500).json({ error: { message: 'Authorization check failed' } });
        }
      }
    };
  }

  /**
   * Middleware to check resource ownership or admin access
   */
  static requireOwnershipOrPermission(
    resourceType: ResourceContext['resourceType'],
    permission: Permission,
    getResourceId: (req: Request) => string | undefined,
    getResourceOwnerId?: (req: Request) => Promise<string | undefined>
  ) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const userId = req.user?.sub;
        if (!userId) {
          throw ApiError.unauthorized('Authentication required');
        }

        const resourceId = getResourceId(req);
        const organizationId = req.params.organizationId || req.query.organizationId as string || req.user?.organizationId;

        // Check if user owns the resource
        if (getResourceOwnerId && resourceId) {
          const ownerId = await getResourceOwnerId(req);
          if (ownerId === userId) {
            return next();
          }
        }

        // Check if user has the required permission
        const hasPermission = await authorizationService.hasPermission(
          userId,
          permission,
          organizationId,
          { resourceType, resourceId, organizationId }
        );

        if (!hasPermission) {
          throw ApiError.forbidden('Access denied: must be resource owner or have appropriate permissions');
        }

        next();
      } catch (error) {
        if (error instanceof ApiError) {
          res.status(error.statusCode).json(error.toJSON());
        } else {
          logger.error('Authorization check failed', { error });
          res.status(500).json({ error: { message: 'Authorization check failed' } });
        }
      }
    };
  }

  /**
   * Middleware to load user permissions into request
   */
  static async loadPermissions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        return next();
      }

      const organizationId = req.params.organizationId ||
                            req.query.organizationId as string ||
                            req.headers['x-organization-id'] as string;

      const userPermissions = await authorizationService.getUserPermissions(userId, organizationId);

      // Update request user object with permissions
      if (req.user) {
        req.user.organizationId = userPermissions.organizationId;
        req.user.role = userPermissions.role;
        req.user.permissions = userPermissions.permissions;
      }

      // Load organization details if applicable
      if (organizationId) {
        await AuthorizationMiddleware.loadOrganization(req, organizationId);
      }

      next();
    } catch (error) {
      // Don't fail the request if permission loading fails, just log it
      logger.warn('Failed to load user permissions', { error, userId: req.user?.sub });
      next();
    }
  }

  /**
   * Middleware to check organization membership
   */
  static requireOrganizationMembership(getOrganizationId?: (req: Request) => string | undefined) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const userId = req.user?.sub;
        if (!userId) {
          throw ApiError.unauthorized('Authentication required');
        }

        const organizationId = getOrganizationId
          ? getOrganizationId(req)
          : req.params.organizationId || req.query.organizationId as string;

        if (!organizationId) {
          throw ApiError.badRequest('Organization ID is required');
        }

        await authorizationService.requirePermission(userId, Permission.ORG_READ, organizationId);

        next();
      } catch (error) {
        if (error instanceof ApiError) {
          res.status(error.statusCode).json(error.toJSON());
        } else {
          logger.error('Organization membership check failed', { error });
          res.status(500).json({ error: { message: 'Organization membership check failed' } });
        }
      }
    };
  }

  /**
   * Middleware to require specific role
   */
  static requireRole(role: Role, getOrganizationId?: (req: Request) => string | undefined) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const userId = req.user?.sub;
        if (!userId) {
          throw ApiError.unauthorized('Authentication required');
        }

        const organizationId = getOrganizationId
          ? getOrganizationId(req)
          : req.params.organizationId || req.query.organizationId as string || req.user?.organizationId;

        const userPermissions = await authorizationService.getUserPermissions(userId, organizationId);

        if (userPermissions.role !== role) {
          throw ApiError.forbidden(`Role ${role} is required`);
        }

        next();
      } catch (error) {
        if (error instanceof ApiError) {
          res.status(error.statusCode).json(error.toJSON());
        } else {
          logger.error('Role check failed', { error });
          res.status(500).json({ error: { message: 'Role check failed' } });
        }
      }
    };
  }

  /**
   * Middleware to require minimum role level
   */
  static requireMinimumRole(minRole: Role, getOrganizationId?: (req: Request) => string | undefined) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const userId = req.user?.sub;
        if (!userId) {
          throw ApiError.unauthorized('Authentication required');
        }

        const organizationId = getOrganizationId
          ? getOrganizationId(req)
          : req.params.organizationId || req.query.organizationId as string || req.user?.organizationId;

        const userPermissions = await authorizationService.getUserPermissions(userId, organizationId);

        const roleHierarchy: Record<Role, number> = {
          [Role.SUPER_ADMIN]: 5,
          [Role.ORG_OWNER]: 4,
          [Role.ORG_ADMIN]: 3,
          [Role.ORG_MEMBER]: 2,
          [Role.ORG_VIEWER]: 1,
        };

        if (roleHierarchy[userPermissions.role] < roleHierarchy[minRole]) {
          throw ApiError.forbidden(`Minimum role ${minRole} is required`);
        }

        next();
      } catch (error) {
        if (error instanceof ApiError) {
          res.status(error.statusCode).json(error.toJSON());
        } else {
          logger.error('Role check failed', { error });
          res.status(500).json({ error: { message: 'Role check failed' } });
        }
      }
    };
  }

  /**
   * Private helper to load organization details
   */
  private static async loadOrganization(req: Request, organizationId: string): Promise<void> {
    try {
      const db = await getDatabase();
      const organization = await db('organizations')
        .where('id', organizationId)
        .where('status', 'active')
        .select('id', 'name', 'slug')
        .first();

      if (organization) {
        req.organization = organization;
      }
    } catch (error) {
      logger.warn('Failed to load organization details', { error, organizationId });
    }
  }
}

// Export convenient middleware shortcuts
export const requirePermission = AuthorizationMiddleware.requirePermission;
export const requireAnyPermission = AuthorizationMiddleware.requireAnyPermission;
export const requireAllPermissions = AuthorizationMiddleware.requireAllPermissions;
export const requireOwnershipOrPermission = AuthorizationMiddleware.requireOwnershipOrPermission;
export const loadPermissions = AuthorizationMiddleware.loadPermissions;
export const requireOrganizationMembership = AuthorizationMiddleware.requireOrganizationMembership;
export const requireRole = AuthorizationMiddleware.requireRole;
export const requireMinimumRole = AuthorizationMiddleware.requireMinimumRole;

// Common permission combinations
export const requireOrgOwner = requireRole(Role.ORG_OWNER);
export const requireOrgAdmin = requireMinimumRole(Role.ORG_ADMIN);
export const requireOrgMember = requireMinimumRole(Role.ORG_MEMBER);
export const requireSuperAdmin = requireRole(Role.SUPER_ADMIN);

// Resource-specific shortcuts
export const requireBenchmarkCreate = requirePermission(Permission.BENCHMARK_CREATE);
export const requireBenchmarkRead = requirePermission(Permission.BENCHMARK_READ);
export const requireBenchmarkUpdate = requirePermission(Permission.BENCHMARK_UPDATE);
export const requireBenchmarkDelete = requirePermission(Permission.BENCHMARK_DELETE);

export const requireApiKeyManagement = requireAnyPermission([
  Permission.API_CREATE_KEYS,
  Permission.API_UPDATE_KEYS,
  Permission.API_DELETE_KEYS,
]);

export const requireUserManagement = requireAnyPermission([
  Permission.USER_INVITE,
  Permission.USER_UPDATE,
  Permission.USER_DELETE,
  Permission.USER_MANAGE_ROLES,
]);

export const requireDataManagement = requireAnyPermission([
  Permission.DATA_UPLOAD,
  Permission.DATA_UPDATE,
  Permission.DATA_DELETE,
  Permission.DATA_IMPORT,
]);
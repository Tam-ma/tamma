/**
 * RBAC middleware functions for API route protection
 */

import type { LoaderFunctionArgs, ActionFunctionArgs } from '@remix-run/node';
import { jsonResponse } from '~/lib/utils/responses';
import { requireAuth, getUser } from './session.server';
import { getUserById } from '~/lib/db/users.server';
import {
  Permission,
  Role,
  hasPermission,
  hasMinimumRole,
  canApprove,
  canManageUsers,
  canModifyResource,
  canDeleteResource,
  requirePermission as assertPermission,
  requireMinimumRole as assertMinimumRole,
  logPermissionViolation,
  type UserWithRole,
} from './permissions';

/**
 * Get user with role from request
 */
export async function getUserWithRole(
  request: Request,
  context: any
): Promise<UserWithRole | null> {
  const env = context.env ?? context.cloudflare?.env ?? {};
  const sessionUser = await getUser(request, { env });

  if (!sessionUser) {
    return null;
  }

  // Fetch user from database to get role
  const dbUser = await getUserById(env, sessionUser.id);

  if (!dbUser) {
    // Default to viewer if user not in DB yet
    return {
      id: sessionUser.id,
      role: Role.VIEWER,
      username: sessionUser.username,
      email: sessionUser.email,
      name: sessionUser.name,
    };
  }

  return {
    id: dbUser.id,
    role: dbUser.role || Role.VIEWER,
    username: sessionUser.username,
    email: dbUser.email,
    name: dbUser.name,
  };
}

/**
 * Require authentication and get user with role
 */
export async function requireAuthWithRole(
  request: Request,
  context: any
): Promise<UserWithRole> {
  const env = context.env ?? context.cloudflare?.env ?? {};
  const sessionUser = await requireAuth(request, { env });

  // Fetch user from database to get role
  const dbUser = await getUserById(env, sessionUser.id);

  if (!dbUser) {
    // Default to viewer if user not in DB yet
    return {
      id: sessionUser.id,
      role: Role.VIEWER,
      username: sessionUser.username,
      email: sessionUser.email,
      name: sessionUser.name,
    };
  }

  return {
    id: dbUser.id,
    role: dbUser.role || Role.VIEWER,
    username: sessionUser.username,
    email: dbUser.email,
    name: dbUser.name,
  };
}

/**
 * Middleware to require a minimum role
 */
export function requireRole(minRole: Role) {
  return async (
    args: LoaderFunctionArgs | ActionFunctionArgs
  ): Promise<UserWithRole | Response> => {
    const { request, context } = args;

    try {
      const user = await requireAuthWithRole(request, context);

      if (!hasMinimumRole(user, minRole)) {
        logPermissionViolation(user, undefined, {
          requiredRole: minRole,
          endpoint: new URL(request.url).pathname,
          method: request.method,
        });

        return jsonResponse(
          {
            error: 'Forbidden',
            message: `This action requires ${minRole} role or higher`,
            requiredRole: minRole,
            userRole: user.role,
          },
          { status: 403 }
        );
      }

      return user;
    } catch (error) {
      // If requireAuth throws a redirect, let it through
      if (error instanceof Response) {
        throw error;
      }

      console.error('Role check failed:', error);
      return jsonResponse(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }
  };
}

/**
 * Middleware to require a specific permission
 */
export function requirePermission(permission: Permission) {
  return async (
    args: LoaderFunctionArgs | ActionFunctionArgs
  ): Promise<UserWithRole | Response> => {
    const { request, context } = args;

    try {
      const user = await requireAuthWithRole(request, context);

      if (!hasPermission(user, permission)) {
        logPermissionViolation(user, permission, {
          endpoint: new URL(request.url).pathname,
          method: request.method,
        });

        return jsonResponse(
          {
            error: 'Forbidden',
            message: `This action requires permission: ${permission}`,
            requiredPermission: permission,
            userRole: user.role,
          },
          { status: 403 }
        );
      }

      return user;
    } catch (error) {
      // If requireAuth throws a redirect, let it through
      if (error instanceof Response) {
        throw error;
      }

      console.error('Permission check failed:', error);
      return jsonResponse(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }
  };
}

/**
 * Check if user can approve suggestions (helper middleware)
 */
export async function checkCanApprove(
  request: Request,
  context: any
): Promise<{ user: UserWithRole; canApprove: boolean }> {
  const user = await requireAuthWithRole(request, context);
  return {
    user,
    canApprove: canApprove(user),
  };
}

/**
 * Check if user can manage users (helper middleware)
 */
export async function checkCanManageUsers(
  request: Request,
  context: any
): Promise<{ user: UserWithRole; canManage: boolean }> {
  const user = await requireAuthWithRole(request, context);
  return {
    user,
    canManage: canManageUsers(user),
  };
}

/**
 * Middleware to check resource ownership or admin privileges
 */
export function requireResourceOwnership(
  getOwnerId: (args: any) => Promise<string | null>
) {
  return async (
    args: LoaderFunctionArgs | ActionFunctionArgs
  ): Promise<UserWithRole | Response> => {
    const { request, context } = args;

    try {
      const user = await requireAuthWithRole(request, context);
      const ownerId = await getOwnerId(args);

      if (!ownerId) {
        return jsonResponse(
          { error: 'Resource not found' },
          { status: 404 }
        );
      }

      if (!canModifyResource(user, ownerId)) {
        logPermissionViolation(user, Permission.EDIT_ANY, {
          endpoint: new URL(request.url).pathname,
          method: request.method,
          resourceOwnerId: ownerId,
        });

        return jsonResponse(
          {
            error: 'Forbidden',
            message: 'You can only modify your own resources',
            userRole: user.role,
          },
          { status: 403 }
        );
      }

      return user;
    } catch (error) {
      // If requireAuth throws a redirect, let it through
      if (error instanceof Response) {
        throw error;
      }

      console.error('Ownership check failed:', error);
      return jsonResponse(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }
  };
}

/**
 * Middleware to check delete permissions
 */
export function requireDeletePermission(
  getOwnerId: (args: any) => Promise<string | null>
) {
  return async (
    args: LoaderFunctionArgs | ActionFunctionArgs
  ): Promise<UserWithRole | Response> => {
    const { request, context } = args;

    try {
      const user = await requireAuthWithRole(request, context);
      const ownerId = await getOwnerId(args);

      if (!ownerId) {
        return jsonResponse(
          { error: 'Resource not found' },
          { status: 404 }
        );
      }

      if (!canDeleteResource(user, ownerId)) {
        logPermissionViolation(user, Permission.DELETE_ANY, {
          endpoint: new URL(request.url).pathname,
          method: request.method,
          resourceOwnerId: ownerId,
        });

        return jsonResponse(
          {
            error: 'Forbidden',
            message: 'You can only delete your own resources',
            userRole: user.role,
          },
          { status: 403 }
        );
      }

      return user;
    } catch (error) {
      // If requireAuth throws a redirect, let it through
      if (error instanceof Response) {
        throw error;
      }

      console.error('Delete permission check failed:', error);
      return jsonResponse(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }
  };
}

/**
 * Create a protected loader that requires authentication and returns user
 */
export function protectedLoader(
  handler: (args: LoaderFunctionArgs & { user: UserWithRole }) => Promise<Response>
) {
  return async (args: LoaderFunctionArgs): Promise<Response> => {
    const { request, context } = args;

    try {
      const user = await requireAuthWithRole(request, context);
      return handler({ ...args, user });
    } catch (error) {
      // If requireAuth throws a redirect, let it through
      if (error instanceof Response) {
        throw error;
      }

      console.error('Protected loader failed:', error);
      return jsonResponse(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }
  };
}

/**
 * Create a protected action that requires authentication and returns user
 */
export function protectedAction(
  handler: (args: ActionFunctionArgs & { user: UserWithRole }) => Promise<Response>
) {
  return async (args: ActionFunctionArgs): Promise<Response> => {
    const { request, context } = args;

    try {
      const user = await requireAuthWithRole(request, context);
      return handler({ ...args, user });
    } catch (error) {
      // If requireAuth throws a redirect, let it through
      if (error instanceof Response) {
        throw error;
      }

      console.error('Protected action failed:', error);
      return jsonResponse(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }
  };
}

/**
 * Batch check multiple permissions
 */
export async function checkPermissions(
  request: Request,
  context: any,
  permissions: Permission[]
): Promise<{
  user: UserWithRole;
  permissions: Record<Permission, boolean>;
  hasAll: boolean;
  hasAny: boolean;
}> {
  const user = await requireAuthWithRole(request, context);

  const permissionResults: Record<Permission, boolean> = {} as any;
  for (const permission of permissions) {
    permissionResults[permission] = hasPermission(user, permission);
  }

  const hasAll = permissions.every(p => permissionResults[p]);
  const hasAny = permissions.some(p => permissionResults[p]);

  return {
    user,
    permissions: permissionResults,
    hasAll,
    hasAny,
  };
}

// Export helpers
export { canApprove, canManageUsers } from './permissions';
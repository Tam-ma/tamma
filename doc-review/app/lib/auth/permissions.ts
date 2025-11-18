/**
 * RBAC (Role-Based Access Control) permission system
 */

// Permission types
export enum Permission {
  // Document permissions
  READ = 'read',

  // Collaboration permissions
  COMMENT = 'comment',
  SUGGEST = 'suggest',

  // Review permissions
  APPROVE = 'approve',
  REJECT = 'reject',

  // Administrative permissions
  ADMIN = 'admin',
  MANAGE_USERS = 'manage_users',
  DELETE_ANY = 'delete_any',
  EDIT_ANY = 'edit_any',
}

// User roles
export enum Role {
  VIEWER = 'viewer',
  REVIEWER = 'reviewer',
  ADMIN = 'admin',
}

// Role hierarchy (higher values = more privileges)
export const RoleHierarchy: Record<Role, number> = {
  [Role.VIEWER]: 0,
  [Role.REVIEWER]: 1,
  [Role.ADMIN]: 2,
};

// Role to permissions mapping
export const RolePermissions: Record<Role, Permission[]> = {
  [Role.VIEWER]: [
    Permission.READ,
  ],

  [Role.REVIEWER]: [
    Permission.READ,
    Permission.COMMENT,
    Permission.SUGGEST,
  ],

  [Role.ADMIN]: [
    Permission.READ,
    Permission.COMMENT,
    Permission.SUGGEST,
    Permission.APPROVE,
    Permission.REJECT,
    Permission.ADMIN,
    Permission.MANAGE_USERS,
    Permission.DELETE_ANY,
    Permission.EDIT_ANY,
  ],
};

// User interface with role
export interface UserWithRole {
  id: string;
  role: string;
  username?: string;
  email?: string;
  name?: string;
  avatarUrl?: string;
}

// Permission check results
export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
  requiredRole?: Role;
}

/**
 * Check if a user has a specific permission
 */
export function hasPermission(
  user: UserWithRole | null | undefined,
  permission: Permission
): boolean {
  if (!user || !user.role) {
    return false;
  }

  const userRole = user.role.toLowerCase() as Role;
  if (!Object.values(Role).includes(userRole)) {
    console.warn(`Invalid role: ${user.role}`);
    return false;
  }

  const permissions = RolePermissions[userRole];
  return permissions.includes(permission);
}

/**
 * Check if a user has all specified permissions
 */
export function hasAllPermissions(
  user: UserWithRole | null | undefined,
  permissions: Permission[]
): boolean {
  return permissions.every(permission => hasPermission(user, permission));
}

/**
 * Check if a user has any of the specified permissions
 */
export function hasAnyPermission(
  user: UserWithRole | null | undefined,
  permissions: Permission[]
): boolean {
  return permissions.some(permission => hasPermission(user, permission));
}

/**
 * Require a user to have a specific permission, throw if not
 */
export function requirePermission(
  user: UserWithRole | null | undefined,
  permission: Permission,
  message?: string
): void {
  if (!hasPermission(user, permission)) {
    const errorMessage = message || `Insufficient permissions. Required: ${permission}`;
    throw new PermissionError(errorMessage, permission, user?.role);
  }
}

/**
 * Check if a user meets a minimum role requirement
 */
export function hasMinimumRole(
  user: UserWithRole | null | undefined,
  minRole: Role
): boolean {
  if (!user || !user.role) {
    return false;
  }

  const userRole = user.role.toLowerCase() as Role;
  if (!Object.values(Role).includes(userRole)) {
    return false;
  }

  return RoleHierarchy[userRole] >= RoleHierarchy[minRole];
}

/**
 * Require a user to have a minimum role, throw if not
 */
export function requireMinimumRole(
  user: UserWithRole | null | undefined,
  minRole: Role,
  message?: string
): void {
  if (!hasMinimumRole(user, minRole)) {
    const errorMessage = message || `Insufficient role. Required: ${minRole} or higher`;
    throw new PermissionError(errorMessage, undefined, user?.role, minRole);
  }
}

/**
 * Check if a user can approve suggestions
 */
export function canApprove(user: UserWithRole | null | undefined): boolean {
  return hasPermission(user, Permission.APPROVE);
}

/**
 * Check if a user can manage other users
 */
export function canManageUsers(user: UserWithRole | null | undefined): boolean {
  return hasPermission(user, Permission.MANAGE_USERS);
}

/**
 * Check if a user can edit any resource (admin privilege)
 */
export function canEditAny(user: UserWithRole | null | undefined): boolean {
  return hasPermission(user, Permission.EDIT_ANY);
}

/**
 * Check if a user can delete any resource (admin privilege)
 */
export function canDeleteAny(user: UserWithRole | null | undefined): boolean {
  return hasPermission(user, Permission.DELETE_ANY);
}

/**
 * Check if a user owns a resource or has admin privileges
 */
export function canModifyResource(
  user: UserWithRole | null | undefined,
  resourceOwnerId: string
): boolean {
  if (!user) return false;

  // Owner can modify their own resources
  if (user.id === resourceOwnerId) {
    return true;
  }

  // Admins can modify any resource
  return canEditAny(user);
}

/**
 * Check if a user can delete a resource (owner or admin)
 */
export function canDeleteResource(
  user: UserWithRole | null | undefined,
  resourceOwnerId: string
): boolean {
  if (!user) return false;

  // Owner can delete their own resources
  if (user.id === resourceOwnerId) {
    return true;
  }

  // Admins can delete any resource
  return canDeleteAny(user);
}

/**
 * Get the minimum role required for a permission
 */
export function getMinimumRoleForPermission(permission: Permission): Role | null {
  for (const [role, permissions] of Object.entries(RolePermissions)) {
    if (permissions.includes(permission)) {
      return role as Role;
    }
  }
  return null;
}

/**
 * Get all permissions for a role
 */
export function getPermissionsForRole(role: Role): Permission[] {
  return RolePermissions[role] || [];
}

/**
 * Check if a role is valid
 */
export function isValidRole(role: string): boolean {
  return Object.values(Role).includes(role.toLowerCase() as Role);
}

/**
 * Normalize a role string to ensure consistency
 */
export function normalizeRole(role: string): Role {
  const normalized = role.toLowerCase() as Role;
  if (!isValidRole(normalized)) {
    throw new Error(`Invalid role: ${role}`);
  }
  return normalized;
}

/**
 * Custom error class for permission violations
 */
export class PermissionError extends Error {
  constructor(
    message: string,
    public readonly requiredPermission?: Permission,
    public readonly userRole?: string,
    public readonly requiredRole?: Role
  ) {
    super(message);
    this.name = 'PermissionError';
  }
}

/**
 * Format a permission check result for logging
 */
export function formatPermissionCheck(
  user: UserWithRole | null | undefined,
  permission: Permission,
  allowed: boolean
): string {
  const userId = user?.id || 'anonymous';
  const userRole = user?.role || 'none';
  const result = allowed ? 'ALLOWED' : 'DENIED';

  return `[RBAC] ${result}: User ${userId} (role: ${userRole}) for permission: ${permission}`;
}

/**
 * Log a permission violation for security auditing
 * @deprecated Use logSecurityViolation from audit.server.ts instead for database logging
 */
export function logPermissionViolation(
  user: UserWithRole | null | undefined,
  permission: Permission,
  context?: Record<string, unknown>
): void {
  const timestamp = new Date().toISOString();
  const userId = user?.id || 'anonymous';
  const userRole = user?.role || 'none';

  console.warn(
    `[SECURITY] Permission violation at ${timestamp}:`,
    {
      userId,
      userRole,
      requiredPermission: permission,
      context,
    }
  );
}
/**
 * Security audit logging for RBAC system
 */

import { getDb, hasDatabase } from '~/lib/db/client.server';
import { activityLog } from '~/lib/db/schema';
import type { UserWithRole, Permission } from './permissions';

export enum AuditAction {
  // Authentication
  LOGIN_SUCCESS = 'login_success',
  LOGIN_FAILED = 'login_failed',
  LOGOUT = 'logout',
  SESSION_EXPIRED = 'session_expired',

  // Authorization
  PERMISSION_GRANTED = 'permission_granted',
  PERMISSION_DENIED = 'permission_denied',
  ROLE_CHECK_PASSED = 'role_check_passed',
  ROLE_CHECK_FAILED = 'role_check_failed',

  // Resource Access
  RESOURCE_ACCESSED = 'resource_accessed',
  RESOURCE_MODIFIED = 'resource_modified',
  RESOURCE_DELETED = 'resource_deleted',
  UNAUTHORIZED_ACCESS_ATTEMPT = 'unauthorized_access_attempt',

  // Admin Actions
  USER_ROLE_CHANGED = 'user_role_changed',
  SUGGESTION_APPROVED = 'suggestion_approved',
  SUGGESTION_REJECTED = 'suggestion_rejected',
  ADMIN_ACTION = 'admin_action',

  // Security Events
  SECURITY_VIOLATION = 'security_violation',
  SUSPICIOUS_ACTIVITY = 'suspicious_activity',
  RATE_LIMIT_EXCEEDED = 'rate_limit_exceeded',
}

export interface AuditLogEntry {
  userId: string;
  userRole?: string;
  action: AuditAction;
  resourceType: string;
  resourceId: string;
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  timestamp: number;
}

/**
 * Log an audit event to the database
 */
export async function logAuditEvent(
  env: { DB?: D1Database },
  entry: AuditLogEntry
): Promise<void> {
  if (!hasDatabase(env)) {
    // If no database, log to console for now
    console.log('[AUDIT]', JSON.stringify(entry));
    return;
  }

  try {
    const db = getDb(env);
    const id = crypto.randomUUID();

    await db.insert(activityLog).values({
      id,
      userId: entry.userId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      metadata: JSON.stringify({
        ...entry.metadata,
        userRole: entry.userRole,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
      }),
      createdAt: entry.timestamp,
    });
  } catch (error) {
    // Don't let audit logging failures break the application
    console.error('[AUDIT] Failed to log event:', error);
  }
}

/**
 * Log a permission check (both granted and denied)
 */
export async function logPermissionCheck(
  env: { DB?: D1Database },
  user: UserWithRole | null,
  permission: Permission,
  granted: boolean,
  context?: Record<string, any>,
  request?: Request
): Promise<void> {
  const entry: AuditLogEntry = {
    userId: user?.id || 'anonymous',
    userRole: user?.role,
    action: granted ? AuditAction.PERMISSION_GRANTED : AuditAction.PERMISSION_DENIED,
    resourceType: 'permission',
    resourceId: permission,
    metadata: {
      permission,
      granted,
      ...context,
    },
    ipAddress: request?.headers.get('cf-connecting-ip') ||
                request?.headers.get('x-forwarded-for') ||
                'unknown',
    userAgent: request?.headers.get('user-agent') || 'unknown',
    timestamp: Date.now(),
  };

  await logAuditEvent(env, entry);
}

/**
 * Log a security violation
 */
export async function logSecurityViolation(
  env: { DB?: D1Database },
  user: UserWithRole | null,
  violationType: string,
  details: Record<string, any>,
  request?: Request
): Promise<void> {
  const entry: AuditLogEntry = {
    userId: user?.id || 'anonymous',
    userRole: user?.role,
    action: AuditAction.SECURITY_VIOLATION,
    resourceType: 'security',
    resourceId: violationType,
    metadata: {
      violationType,
      ...details,
      timestamp: new Date().toISOString(),
    },
    ipAddress: request?.headers.get('cf-connecting-ip') ||
                request?.headers.get('x-forwarded-for') ||
                'unknown',
    userAgent: request?.headers.get('user-agent') || 'unknown',
    timestamp: Date.now(),
  };

  await logAuditEvent(env, entry);

  // Also log to console for immediate visibility
  console.error('[SECURITY VIOLATION]', JSON.stringify(entry));
}

/**
 * Log an admin action
 */
export async function logAdminAction(
  env: { DB?: D1Database },
  admin: UserWithRole,
  action: string,
  targetType: string,
  targetId: string,
  details?: Record<string, any>,
  request?: Request
): Promise<void> {
  const entry: AuditLogEntry = {
    userId: admin.id,
    userRole: admin.role,
    action: AuditAction.ADMIN_ACTION,
    resourceType: targetType,
    resourceId: targetId,
    metadata: {
      adminAction: action,
      ...details,
    },
    ipAddress: request?.headers.get('cf-connecting-ip') ||
                request?.headers.get('x-forwarded-for') ||
                'unknown',
    userAgent: request?.headers.get('user-agent') || 'unknown',
    timestamp: Date.now(),
  };

  await logAuditEvent(env, entry);
}

/**
 * Log a user role change
 */
export async function logRoleChange(
  env: { DB?: D1Database },
  admin: UserWithRole,
  targetUserId: string,
  oldRole: string,
  newRole: string,
  request?: Request
): Promise<void> {
  const entry: AuditLogEntry = {
    userId: admin.id,
    userRole: admin.role,
    action: AuditAction.USER_ROLE_CHANGED,
    resourceType: 'user',
    resourceId: targetUserId,
    metadata: {
      targetUserId,
      oldRole,
      newRole,
      changedBy: admin.id,
    },
    ipAddress: request?.headers.get('cf-connecting-ip') ||
                request?.headers.get('x-forwarded-for') ||
                'unknown',
    userAgent: request?.headers.get('user-agent') || 'unknown',
    timestamp: Date.now(),
  };

  await logAuditEvent(env, entry);
}

/**
 * Get audit logs for a specific user
 */
export async function getUserAuditLogs(
  env: { DB?: D1Database },
  userId: string,
  limit: number = 100
): Promise<any[]> {
  if (!hasDatabase(env)) {
    return [];
  }

  const db = getDb(env);
  const logs = await db
    .select()
    .from(activityLog)
    .where(eq(activityLog.userId, userId))
    .orderBy(desc(activityLog.createdAt))
    .limit(limit)
    .all();

  return logs.map(log => ({
    ...log,
    metadata: log.metadata ? JSON.parse(log.metadata) : null,
  }));
}

/**
 * Get security-related audit logs
 */
export async function getSecurityAuditLogs(
  env: { DB?: D1Database },
  limit: number = 100
): Promise<any[]> {
  if (!hasDatabase(env)) {
    return [];
  }

  const db = getDb(env);
  const logs = await db
    .select()
    .from(activityLog)
    .where(
      or(
        eq(activityLog.action, AuditAction.SECURITY_VIOLATION),
        eq(activityLog.action, AuditAction.PERMISSION_DENIED),
        eq(activityLog.action, AuditAction.UNAUTHORIZED_ACCESS_ATTEMPT),
        eq(activityLog.action, AuditAction.SUSPICIOUS_ACTIVITY)
      )
    )
    .orderBy(desc(activityLog.createdAt))
    .limit(limit)
    .all();

  return logs.map(log => ({
    ...log,
    metadata: log.metadata ? JSON.parse(log.metadata) : null,
  }));
}

// Import required Drizzle functions
import { eq, desc, or } from 'drizzle-orm';
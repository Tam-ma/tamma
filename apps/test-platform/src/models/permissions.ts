/**
 * Permission and Role definitions for the RBAC system
 * Defines all available permissions and their assignment to roles
 */

export enum Role {
  SUPER_ADMIN = 'super_admin',
  ORG_OWNER = 'owner',
  ORG_ADMIN = 'admin',
  ORG_MEMBER = 'member',
  ORG_VIEWER = 'viewer',
}

export enum Permission {
  // System permissions (super_admin only)
  SYSTEM_ADMIN = 'system.admin',
  SYSTEM_USER_MANAGEMENT = 'system.user_management',
  SYSTEM_ORGANIZATION_MANAGEMENT = 'system.organization_management',
  SYSTEM_AUDIT_LOGS = 'system.audit_logs',
  SYSTEM_METRICS = 'system.metrics',
  SYSTEM_SETTINGS = 'system.settings',
  SYSTEM_BACKUP = 'system.backup',

  // Organization permissions
  ORG_CREATE = 'organization.create',
  ORG_READ = 'organization.read',
  ORG_UPDATE = 'organization.update',
  ORG_DELETE = 'organization.delete',
  ORG_MANAGE_SETTINGS = 'organization.manage_settings',
  ORG_MANAGE_BILLING = 'organization.manage_billing',
  ORG_MANAGE_MEMBERS = 'organization.manage_members',
  ORG_VIEW_AUDIT_LOGS = 'organization.view_audit_logs',
  ORG_MANAGE_INTEGRATIONS = 'organization.manage_integrations',

  // User management permissions
  USER_INVITE = 'user.invite',
  USER_READ = 'user.read',
  USER_UPDATE = 'user.update',
  USER_DELETE = 'user.delete',
  USER_MANAGE_ROLES = 'user.manage_roles',
  USER_DEACTIVATE = 'user.deactivate',
  USER_IMPERSONATE = 'user.impersonate',

  // Benchmark permissions
  BENCHMARK_CREATE = 'benchmark.create',
  BENCHMARK_READ = 'benchmark.read',
  BENCHMARK_UPDATE = 'benchmark.update',
  BENCHMARK_DELETE = 'benchmark.delete',
  BENCHMARK_RUN = 'benchmark.run',
  BENCHMARK_VIEW_RESULTS = 'benchmark.view_results',
  BENCHMARK_EXPORT = 'benchmark.export',
  BENCHMARK_SHARE = 'benchmark.share',
  BENCHMARK_MANAGE_TEMPLATES = 'benchmark.manage_templates',

  // API permissions
  API_CREATE_KEYS = 'api.create_keys',
  API_READ_KEYS = 'api.read_keys',
  API_UPDATE_KEYS = 'api.update_keys',
  API_DELETE_KEYS = 'api.delete_keys',
  API_VIEW_USAGE = 'api.view_usage',
  API_MANAGE_QUOTAS = 'api.manage_quotas',

  // Data permissions
  DATA_UPLOAD = 'data.upload',
  DATA_READ = 'data.read',
  DATA_UPDATE = 'data.update',
  DATA_DELETE = 'data.delete',
  DATA_EXPORT = 'data.export',
  DATA_IMPORT = 'data.import',
  DATA_ARCHIVE = 'data.archive',

  // Report permissions
  REPORT_CREATE = 'report.create',
  REPORT_READ = 'report.read',
  REPORT_UPDATE = 'report.update',
  REPORT_DELETE = 'report.delete',
  REPORT_SHARE = 'report.share',
  REPORT_SCHEDULE = 'report.schedule',

  // Workspace permissions
  WORKSPACE_CREATE = 'workspace.create',
  WORKSPACE_READ = 'workspace.read',
  WORKSPACE_UPDATE = 'workspace.update',
  WORKSPACE_DELETE = 'workspace.delete',
  WORKSPACE_MANAGE_MEMBERS = 'workspace.manage_members',
}

export interface RolePermissions {
  [Role.SUPER_ADMIN]: Permission[];
  [Role.ORG_OWNER]: Permission[];
  [Role.ORG_ADMIN]: Permission[];
  [Role.ORG_MEMBER]: Permission[];
  [Role.ORG_VIEWER]: Permission[];
}

export const ROLE_PERMISSIONS: RolePermissions = {
  [Role.SUPER_ADMIN]: [
    // All system permissions
    Permission.SYSTEM_ADMIN,
    Permission.SYSTEM_USER_MANAGEMENT,
    Permission.SYSTEM_ORGANIZATION_MANAGEMENT,
    Permission.SYSTEM_AUDIT_LOGS,
    Permission.SYSTEM_METRICS,
    Permission.SYSTEM_SETTINGS,
    Permission.SYSTEM_BACKUP,

    // All organization permissions
    Permission.ORG_CREATE,
    Permission.ORG_READ,
    Permission.ORG_UPDATE,
    Permission.ORG_DELETE,
    Permission.ORG_MANAGE_SETTINGS,
    Permission.ORG_MANAGE_BILLING,
    Permission.ORG_MANAGE_MEMBERS,
    Permission.ORG_VIEW_AUDIT_LOGS,
    Permission.ORG_MANAGE_INTEGRATIONS,

    // All user permissions
    Permission.USER_INVITE,
    Permission.USER_READ,
    Permission.USER_UPDATE,
    Permission.USER_DELETE,
    Permission.USER_MANAGE_ROLES,
    Permission.USER_DEACTIVATE,
    Permission.USER_IMPERSONATE,

    // All benchmark permissions
    Permission.BENCHMARK_CREATE,
    Permission.BENCHMARK_READ,
    Permission.BENCHMARK_UPDATE,
    Permission.BENCHMARK_DELETE,
    Permission.BENCHMARK_RUN,
    Permission.BENCHMARK_VIEW_RESULTS,
    Permission.BENCHMARK_EXPORT,
    Permission.BENCHMARK_SHARE,
    Permission.BENCHMARK_MANAGE_TEMPLATES,

    // All API permissions
    Permission.API_CREATE_KEYS,
    Permission.API_READ_KEYS,
    Permission.API_UPDATE_KEYS,
    Permission.API_DELETE_KEYS,
    Permission.API_VIEW_USAGE,
    Permission.API_MANAGE_QUOTAS,

    // All data permissions
    Permission.DATA_UPLOAD,
    Permission.DATA_READ,
    Permission.DATA_UPDATE,
    Permission.DATA_DELETE,
    Permission.DATA_EXPORT,
    Permission.DATA_IMPORT,
    Permission.DATA_ARCHIVE,

    // All report permissions
    Permission.REPORT_CREATE,
    Permission.REPORT_READ,
    Permission.REPORT_UPDATE,
    Permission.REPORT_DELETE,
    Permission.REPORT_SHARE,
    Permission.REPORT_SCHEDULE,

    // All workspace permissions
    Permission.WORKSPACE_CREATE,
    Permission.WORKSPACE_READ,
    Permission.WORKSPACE_UPDATE,
    Permission.WORKSPACE_DELETE,
    Permission.WORKSPACE_MANAGE_MEMBERS,
  ],

  [Role.ORG_OWNER]: [
    // Organization permissions
    Permission.ORG_READ,
    Permission.ORG_UPDATE,
    Permission.ORG_DELETE,
    Permission.ORG_MANAGE_SETTINGS,
    Permission.ORG_MANAGE_BILLING,
    Permission.ORG_MANAGE_MEMBERS,
    Permission.ORG_VIEW_AUDIT_LOGS,
    Permission.ORG_MANAGE_INTEGRATIONS,

    // User permissions
    Permission.USER_INVITE,
    Permission.USER_READ,
    Permission.USER_UPDATE,
    Permission.USER_DELETE,
    Permission.USER_MANAGE_ROLES,
    Permission.USER_DEACTIVATE,

    // Benchmark permissions
    Permission.BENCHMARK_CREATE,
    Permission.BENCHMARK_READ,
    Permission.BENCHMARK_UPDATE,
    Permission.BENCHMARK_DELETE,
    Permission.BENCHMARK_RUN,
    Permission.BENCHMARK_VIEW_RESULTS,
    Permission.BENCHMARK_EXPORT,
    Permission.BENCHMARK_SHARE,
    Permission.BENCHMARK_MANAGE_TEMPLATES,

    // API permissions
    Permission.API_CREATE_KEYS,
    Permission.API_READ_KEYS,
    Permission.API_UPDATE_KEYS,
    Permission.API_DELETE_KEYS,
    Permission.API_VIEW_USAGE,
    Permission.API_MANAGE_QUOTAS,

    // Data permissions
    Permission.DATA_UPLOAD,
    Permission.DATA_READ,
    Permission.DATA_UPDATE,
    Permission.DATA_DELETE,
    Permission.DATA_EXPORT,
    Permission.DATA_IMPORT,
    Permission.DATA_ARCHIVE,

    // Report permissions
    Permission.REPORT_CREATE,
    Permission.REPORT_READ,
    Permission.REPORT_UPDATE,
    Permission.REPORT_DELETE,
    Permission.REPORT_SHARE,
    Permission.REPORT_SCHEDULE,

    // Workspace permissions
    Permission.WORKSPACE_CREATE,
    Permission.WORKSPACE_READ,
    Permission.WORKSPACE_UPDATE,
    Permission.WORKSPACE_DELETE,
    Permission.WORKSPACE_MANAGE_MEMBERS,
  ],

  [Role.ORG_ADMIN]: [
    // Organization permissions
    Permission.ORG_READ,
    Permission.ORG_UPDATE,
    Permission.ORG_MANAGE_MEMBERS,
    Permission.ORG_VIEW_AUDIT_LOGS,
    Permission.ORG_MANAGE_INTEGRATIONS,

    // User permissions
    Permission.USER_INVITE,
    Permission.USER_READ,
    Permission.USER_UPDATE,
    Permission.USER_DEACTIVATE,

    // Benchmark permissions
    Permission.BENCHMARK_CREATE,
    Permission.BENCHMARK_READ,
    Permission.BENCHMARK_UPDATE,
    Permission.BENCHMARK_DELETE,
    Permission.BENCHMARK_RUN,
    Permission.BENCHMARK_VIEW_RESULTS,
    Permission.BENCHMARK_EXPORT,
    Permission.BENCHMARK_SHARE,
    Permission.BENCHMARK_MANAGE_TEMPLATES,

    // API permissions
    Permission.API_CREATE_KEYS,
    Permission.API_READ_KEYS,
    Permission.API_UPDATE_KEYS,
    Permission.API_DELETE_KEYS,
    Permission.API_VIEW_USAGE,

    // Data permissions
    Permission.DATA_UPLOAD,
    Permission.DATA_READ,
    Permission.DATA_UPDATE,
    Permission.DATA_DELETE,
    Permission.DATA_EXPORT,
    Permission.DATA_IMPORT,

    // Report permissions
    Permission.REPORT_CREATE,
    Permission.REPORT_READ,
    Permission.REPORT_UPDATE,
    Permission.REPORT_DELETE,
    Permission.REPORT_SHARE,
    Permission.REPORT_SCHEDULE,

    // Workspace permissions
    Permission.WORKSPACE_CREATE,
    Permission.WORKSPACE_READ,
    Permission.WORKSPACE_UPDATE,
    Permission.WORKSPACE_DELETE,
    Permission.WORKSPACE_MANAGE_MEMBERS,
  ],

  [Role.ORG_MEMBER]: [
    // Organization permissions
    Permission.ORG_READ,

    // User permissions
    Permission.USER_READ,

    // Benchmark permissions
    Permission.BENCHMARK_CREATE,
    Permission.BENCHMARK_READ,
    Permission.BENCHMARK_UPDATE,
    Permission.BENCHMARK_RUN,
    Permission.BENCHMARK_VIEW_RESULTS,
    Permission.BENCHMARK_EXPORT,
    Permission.BENCHMARK_SHARE,

    // API permissions (own keys only)
    Permission.API_CREATE_KEYS,
    Permission.API_READ_KEYS,
    Permission.API_UPDATE_KEYS,
    Permission.API_DELETE_KEYS,
    Permission.API_VIEW_USAGE,

    // Data permissions
    Permission.DATA_UPLOAD,
    Permission.DATA_READ,
    Permission.DATA_UPDATE,
    Permission.DATA_EXPORT,

    // Report permissions
    Permission.REPORT_CREATE,
    Permission.REPORT_READ,
    Permission.REPORT_UPDATE,
    Permission.REPORT_SHARE,

    // Workspace permissions
    Permission.WORKSPACE_CREATE,
    Permission.WORKSPACE_READ,
    Permission.WORKSPACE_UPDATE,
  ],

  [Role.ORG_VIEWER]: [
    // Organization permissions
    Permission.ORG_READ,

    // User permissions
    Permission.USER_READ,

    // Benchmark permissions
    Permission.BENCHMARK_READ,
    Permission.BENCHMARK_VIEW_RESULTS,
    Permission.BENCHMARK_EXPORT,

    // API permissions (read only)
    Permission.API_READ_KEYS,
    Permission.API_VIEW_USAGE,

    // Data permissions
    Permission.DATA_READ,
    Permission.DATA_EXPORT,

    // Report permissions
    Permission.REPORT_READ,

    // Workspace permissions
    Permission.WORKSPACE_READ,
  ],
};

// Role hierarchy for permission inheritance
export const ROLE_HIERARCHY: Record<Role, Role[]> = {
  [Role.SUPER_ADMIN]: [Role.SUPER_ADMIN],
  [Role.ORG_OWNER]: [Role.ORG_OWNER, Role.ORG_ADMIN, Role.ORG_MEMBER, Role.ORG_VIEWER],
  [Role.ORG_ADMIN]: [Role.ORG_ADMIN, Role.ORG_MEMBER, Role.ORG_VIEWER],
  [Role.ORG_MEMBER]: [Role.ORG_MEMBER, Role.ORG_VIEWER],
  [Role.ORG_VIEWER]: [Role.ORG_VIEWER],
};

export interface PermissionContext {
  userId: string;
  organizationId?: string;
  role?: Role;
  permissions?: Permission[];
  customPermissions?: Permission[];
}

export interface ResourceContext {
  resourceType: 'benchmark' | 'api_key' | 'user' | 'organization' | 'report' | 'workspace' | 'data';
  resourceId?: string;
  organizationId?: string;
  ownerId?: string;
  metadata?: Record<string, any>;
}

// Helper function to check if a role includes a permission
export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

// Helper function to get all permissions for a role (including inherited)
export function getRolePermissions(role: Role): Permission[] {
  const permissions = new Set<Permission>();
  const hierarchy = ROLE_HIERARCHY[role] || [role];

  for (const r of hierarchy) {
    const rolePerms = ROLE_PERMISSIONS[r] || [];
    rolePerms.forEach(p => permissions.add(p));
  }

  return Array.from(permissions);
}

// Helper function to check if one role is higher than another
export function isRoleHigherOrEqual(role1: Role, role2: Role): boolean {
  const hierarchy1 = ROLE_HIERARCHY[role1] || [];
  return hierarchy1.includes(role2);
}

// Permission groups for UI display
export const PERMISSION_GROUPS = {
  System: [
    Permission.SYSTEM_ADMIN,
    Permission.SYSTEM_USER_MANAGEMENT,
    Permission.SYSTEM_ORGANIZATION_MANAGEMENT,
    Permission.SYSTEM_AUDIT_LOGS,
    Permission.SYSTEM_METRICS,
    Permission.SYSTEM_SETTINGS,
    Permission.SYSTEM_BACKUP,
  ],
  Organization: [
    Permission.ORG_CREATE,
    Permission.ORG_READ,
    Permission.ORG_UPDATE,
    Permission.ORG_DELETE,
    Permission.ORG_MANAGE_SETTINGS,
    Permission.ORG_MANAGE_BILLING,
    Permission.ORG_MANAGE_MEMBERS,
    Permission.ORG_VIEW_AUDIT_LOGS,
    Permission.ORG_MANAGE_INTEGRATIONS,
  ],
  'User Management': [
    Permission.USER_INVITE,
    Permission.USER_READ,
    Permission.USER_UPDATE,
    Permission.USER_DELETE,
    Permission.USER_MANAGE_ROLES,
    Permission.USER_DEACTIVATE,
    Permission.USER_IMPERSONATE,
  ],
  Benchmarks: [
    Permission.BENCHMARK_CREATE,
    Permission.BENCHMARK_READ,
    Permission.BENCHMARK_UPDATE,
    Permission.BENCHMARK_DELETE,
    Permission.BENCHMARK_RUN,
    Permission.BENCHMARK_VIEW_RESULTS,
    Permission.BENCHMARK_EXPORT,
    Permission.BENCHMARK_SHARE,
    Permission.BENCHMARK_MANAGE_TEMPLATES,
  ],
  API: [
    Permission.API_CREATE_KEYS,
    Permission.API_READ_KEYS,
    Permission.API_UPDATE_KEYS,
    Permission.API_DELETE_KEYS,
    Permission.API_VIEW_USAGE,
    Permission.API_MANAGE_QUOTAS,
  ],
  Data: [
    Permission.DATA_UPLOAD,
    Permission.DATA_READ,
    Permission.DATA_UPDATE,
    Permission.DATA_DELETE,
    Permission.DATA_EXPORT,
    Permission.DATA_IMPORT,
    Permission.DATA_ARCHIVE,
  ],
  Reports: [
    Permission.REPORT_CREATE,
    Permission.REPORT_READ,
    Permission.REPORT_UPDATE,
    Permission.REPORT_DELETE,
    Permission.REPORT_SHARE,
    Permission.REPORT_SCHEDULE,
  ],
  Workspaces: [
    Permission.WORKSPACE_CREATE,
    Permission.WORKSPACE_READ,
    Permission.WORKSPACE_UPDATE,
    Permission.WORKSPACE_DELETE,
    Permission.WORKSPACE_MANAGE_MEMBERS,
  ],
};
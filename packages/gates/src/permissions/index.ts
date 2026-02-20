/**
 * Agent Permissions System
 * @module @tamma/gates/permissions
 */

// Types
export * from './types.js';

// Errors
export {
  PermissionDeniedError,
  PermissionApprovalRequiredError,
  ResourceLimitExceededError,
} from './errors.js';

// Defaults
export {
  getDefaultPermissions,
  getAllDefaultPermissions,
  getAllAgentTypes,
  READ_ONLY_TOOLS,
  ALL_TOOLS,
  BLOCKED_FILE_PATTERNS,
  BLOCKED_COMMANDS,
  PROTECTED_BRANCHES,
} from './defaults.js';

// Matchers
export * from './matchers/index.js';

// Permission Resolver
export {
  PermissionResolver,
  createPermissionResolver,
} from './permission-resolver.js';

// Permission Service
export {
  PermissionService,
  createPermissionService,
} from './permission-service.js';

// Permission Enforcer
export {
  PermissionEnforcer,
  createPermissionEnforcer,
  createEnforcementMiddleware,
  type PermissionEnforcerOptions,
} from './permission-enforcer.js';

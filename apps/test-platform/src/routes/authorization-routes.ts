/**
 * Authorization Routes
 * Defines all endpoints for role and permission management
 */

import { Router } from 'express';
import { authorizationController, AuthorizationController } from '../controllers/authorization-controller';
import { loadPermissions, requirePermission } from '../middleware/authorization-middleware';
import { Permission } from '../models/permissions';

const router = Router();

/**
 * All routes require authentication - this should be applied at the app level
 * All routes should have loadPermissions middleware to populate user permissions
 */
router.use(loadPermissions);

/**
 * GET /api/authorization/roles
 * Get all available roles and their permissions
 * Public endpoint (authenticated users only)
 */
router.get('/roles', (req, res, next) => authorizationController.getRoles(req, res, next));

/**
 * GET /api/authorization/users/:userId/permissions
 * Get user's permissions
 * Users can view their own permissions, others need USER_READ permission
 */
router.get(
  '/users/:userId/permissions',
  AuthorizationController.getUserPermissionsValidation,
  (req, res, next) => authorizationController.getUserPermissions(req, res, next)
);

/**
 * PUT /api/authorization/organizations/:organizationId/users/:userId/role
 * Assign or update a user's role in an organization
 * Requires USER_MANAGE_ROLES permission
 */
router.put(
  '/organizations/:organizationId/users/:userId/role',
  requirePermission(Permission.USER_MANAGE_ROLES, req => req.params.organizationId),
  AuthorizationController.assignRoleValidation,
  (req, res, next) => authorizationController.assignRole(req, res, next)
);

/**
 * GET /api/authorization/organizations/:organizationId/members
 * Get organization members with their roles
 * Requires USER_READ permission
 */
router.get(
  '/organizations/:organizationId/members',
  requirePermission(Permission.USER_READ, req => req.params.organizationId),
  AuthorizationController.getOrganizationMembersValidation,
  (req, res, next) => authorizationController.getOrganizationMembers(req, res, next)
);

/**
 * DELETE /api/authorization/organizations/:organizationId/users/:userId
 * Remove a user from an organization
 * Requires USER_DEACTIVATE permission
 */
router.delete(
  '/organizations/:organizationId/users/:userId',
  requirePermission(Permission.USER_DEACTIVATE, req => req.params.organizationId),
  AuthorizationController.removeUserValidation,
  (req, res, next) => authorizationController.removeUserFromOrganization(req, res, next)
);

/**
 * POST /api/authorization/check-permission
 * Check if current user has a specific permission
 * Public endpoint for authenticated users to check their own permissions
 */
router.post(
  '/check-permission',
  (req, res, next) => authorizationController.checkPermission(req, res, next)
);

export default router;

// Export for use in main app
export { router as authorizationRoutes };
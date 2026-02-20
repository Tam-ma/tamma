/**
 * Permission enforcement middleware
 * @module @tamma/gates/permissions/permission-enforcer
 */

import type {
  AgentType,
  AgentAction,
  IPermissionEnforcer,
  IPermissionService,
  ResourceLimits,
  PermissionViolation,
} from './types.js';
import {
  PermissionDeniedError,
  PermissionApprovalRequiredError,
  ResourceLimitExceededError,
} from './errors.js';
import type { ILogger } from '@tamma/shared';

/**
 * Options for permission enforcement
 */
export interface PermissionEnforcerOptions {
  permissionService: IPermissionService;
  logger?: ILogger;
  /**
   * Whether to record violations automatically
   */
  recordViolations?: boolean;
  /**
   * Default severity for violations
   */
  defaultViolationSeverity?: PermissionViolation['severity'];
}

/**
 * Middleware for enforcing agent permissions before action execution
 */
export class PermissionEnforcer implements IPermissionEnforcer {
  private readonly permissionService: IPermissionService;
  private readonly logger?: ILogger;
  private readonly recordViolations: boolean;
  private readonly defaultViolationSeverity: PermissionViolation['severity'];

  constructor(options: PermissionEnforcerOptions) {
    this.permissionService = options.permissionService;
    this.logger = options.logger;
    this.recordViolations = options.recordViolations ?? true;
    this.defaultViolationSeverity = options.defaultViolationSeverity ?? 'medium';
  }

  /**
   * Enforce permission for an agent action
   * Throws an error if the action is not allowed
   */
  async enforcePermission(
    agentType: AgentType,
    projectId: string,
    action: AgentAction,
  ): Promise<void> {
    this.logger?.debug(`Enforcing permission for ${agentType}: ${action.type}`, {
      projectId,
      action,
    });

    let result;

    switch (action.type) {
      case 'tool':
        if (!action.toolName) {
          throw new PermissionDeniedError('Tool name is required for tool actions');
        }
        result = this.permissionService.checkToolPermission(
          agentType,
          projectId,
          action.toolName,
        );
        break;

      case 'file_read':
        if (!action.path) {
          throw new PermissionDeniedError('Path is required for file read actions');
        }
        result = this.permissionService.checkFilePermission(
          agentType,
          projectId,
          action.path,
          'read',
        );
        break;

      case 'file_write':
        if (!action.path) {
          throw new PermissionDeniedError('Path is required for file write actions');
        }
        result = this.permissionService.checkFilePermission(
          agentType,
          projectId,
          action.path,
          'write',
        );
        break;

      case 'command':
        if (!action.command) {
          throw new PermissionDeniedError('Command is required for command actions');
        }
        result = this.permissionService.checkCommandPermission(
          agentType,
          projectId,
          action.command,
        );
        break;

      case 'git':
        if (!action.operation) {
          throw new PermissionDeniedError('Operation is required for git actions');
        }
        result = this.permissionService.checkGitPermission(
          agentType,
          projectId,
          action.operation,
          action.metadata?.branch as string | undefined,
        );
        break;

      case 'api':
        if (!action.apiUrl) {
          throw new PermissionDeniedError('API URL is required for API actions');
        }
        result = this.permissionService.checkAPIPermission(
          agentType,
          projectId,
          action.apiUrl,
        );
        break;

      default:
        throw new PermissionDeniedError(`Unknown action type: ${action.type}`);
    }

    // Handle permission result
    if (!result.allowed) {
      // Check if approval is required
      if (result.requiresApproval) {
        const requestResult = await this.permissionService.requestPermission({
          agentType,
          projectId,
          taskId: (action.metadata?.taskId as string) ?? 'unknown',
          requestedPermission: result.matchedRule ?? {
            id: 'unknown',
            category: this.actionTypeToCategory(action.type),
            resource: this.getActionResource(action),
            action: 'require_approval',
          },
          reason: `Agent ${agentType} requires approval for action: ${action.type}`,
          duration: 60, // 60 minutes default
        });

        throw new PermissionApprovalRequiredError(
          result.reason ?? 'Action requires approval',
          requestResult.requestId,
        );
      }

      // Record violation if enabled
      if (this.recordViolations) {
        await this.permissionService.recordViolation({
          agentType,
          projectId,
          taskId: action.metadata?.taskId as string | undefined,
          action,
          deniedPermission: result.matchedRule ?? {
            id: 'unknown',
            category: this.actionTypeToCategory(action.type),
            resource: this.getActionResource(action),
            action: 'deny',
          },
          reason: result.reason ?? 'Permission denied',
          severity: this.determineSeverity(action),
          repeated: false,
        });
      }

      // Throw permission denied error
      throw new PermissionDeniedError(result.reason ?? 'Permission denied', {
        suggestedAlternative: result.suggestedAlternative,
      });
    }

    this.logger?.debug(`Permission granted for ${agentType}: ${action.type}`);
  }

  /**
   * Enforce resource limits for an agent
   * Throws an error if any limit is exceeded
   */
  enforceResourceLimits(
    agentType: AgentType,
    projectId: string,
    currentUsage: Partial<ResourceLimits>,
  ): void {
    const resources = Object.entries(currentUsage) as [keyof ResourceLimits, number][];

    for (const [resource, value] of resources) {
      const result = this.permissionService.checkResourceLimit(
        agentType,
        projectId,
        resource,
        value,
      );

      if (!result.allowed) {
        const permissions = this.permissionService.getEffectivePermissions(agentType, projectId);
        const limit = permissions.resources[resource];

        this.logger?.warn(`Resource limit exceeded: ${resource}`, {
          agentType,
          projectId,
          value,
          limit,
        });

        throw new ResourceLimitExceededError(
          result.reason ?? `Resource limit exceeded: ${resource}`,
          resource,
          limit,
          value,
        );
      }
    }
  }

  /**
   * Check if an action would be allowed without throwing
   */
  async wouldAllow(
    agentType: AgentType,
    projectId: string,
    action: AgentAction,
  ): Promise<boolean> {
    try {
      // Temporarily disable violation recording
      const originalRecordViolations = this.recordViolations;
      (this as { recordViolations: boolean }).recordViolations = false;

      try {
        await this.enforcePermission(agentType, projectId, action);
        return true;
      } finally {
        (this as { recordViolations: boolean }).recordViolations = originalRecordViolations;
      }
    } catch {
      return false;
    }
  }

  /**
   * Map action type to permission category
   */
  private actionTypeToCategory(
    actionType: AgentAction['type'],
  ): 'tool' | 'file' | 'command' | 'api' | 'git' | 'resource' {
    switch (actionType) {
      case 'tool':
        return 'tool';
      case 'file_read':
      case 'file_write':
        return 'file';
      case 'command':
        return 'command';
      case 'git':
        return 'git';
      case 'api':
        return 'api';
      default:
        return 'resource';
    }
  }

  /**
   * Get the resource string for an action
   */
  private getActionResource(action: AgentAction): string {
    switch (action.type) {
      case 'tool':
        return action.toolName ?? 'unknown';
      case 'file_read':
      case 'file_write':
        return action.path ?? 'unknown';
      case 'command':
        return action.command ?? 'unknown';
      case 'git':
        return action.operation ?? 'unknown';
      case 'api':
        return action.apiUrl ?? 'unknown';
      default:
        return 'unknown';
    }
  }

  /**
   * Determine the severity of a violation based on the action
   */
  private determineSeverity(action: AgentAction): PermissionViolation['severity'] {
    // Critical for dangerous operations
    if (action.type === 'git' && action.operation === 'force_push') {
      return 'critical';
    }

    if (action.type === 'command') {
      const command = action.command ?? '';
      // Check for dangerous patterns
      if (/rm\s+-rf\s+\/|sudo|mkfs|dd\s+if=/.test(command)) {
        return 'critical';
      }
    }

    // High for write operations to sensitive files
    if (action.type === 'file_write') {
      const path = action.path ?? '';
      if (/\.env|secrets|credentials|\.pem|\.key/.test(path)) {
        return 'high';
      }
    }

    // Medium for other git operations
    if (action.type === 'git') {
      return 'medium';
    }

    return this.defaultViolationSeverity;
  }
}

/**
 * Create a permission enforcer with the given options
 */
export function createPermissionEnforcer(
  options: PermissionEnforcerOptions,
): PermissionEnforcer {
  return new PermissionEnforcer(options);
}

/**
 * Create a simple enforcement function for use in middleware
 */
export function createEnforcementMiddleware(
  enforcer: PermissionEnforcer,
): (agentType: AgentType, projectId: string, action: AgentAction) => Promise<void> {
  return async (agentType, projectId, action) => {
    await enforcer.enforcePermission(agentType, projectId, action);
  };
}

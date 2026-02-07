import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  PermissionEnforcer,
  createPermissionEnforcer,
  createEnforcementMiddleware,
} from './permission-enforcer.js';
import { PermissionService } from './permission-service.js';
import {
  PermissionDeniedError,
  PermissionApprovalRequiredError,
  ResourceLimitExceededError,
} from './errors.js';
import type { AgentAction, PermissionResult } from './types.js';

describe('PermissionEnforcer', () => {
  let permissionService: PermissionService;
  let enforcer: PermissionEnforcer;

  beforeEach(() => {
    permissionService = new PermissionService();
    enforcer = new PermissionEnforcer({
      permissionService,
      recordViolations: true,
    });
  });

  describe('enforcePermission', () => {
    describe('tool actions', () => {
      it('should allow permitted tools', async () => {
        const action: AgentAction = {
          type: 'tool',
          toolName: 'Read',
        };

        await expect(
          enforcer.enforcePermission('implementer', 'project-1', action),
        ).resolves.not.toThrow();
      });

      it('should throw PermissionDeniedError for denied tools', async () => {
        const action: AgentAction = {
          type: 'tool',
          toolName: 'Bash',
        };

        await expect(
          enforcer.enforcePermission('researcher', 'project-1', action),
        ).rejects.toThrow(PermissionDeniedError);
      });

      it('should throw error if tool name is missing', async () => {
        const action: AgentAction = {
          type: 'tool',
        };

        await expect(
          enforcer.enforcePermission('implementer', 'project-1', action),
        ).rejects.toThrow('Tool name is required');
      });
    });

    describe('file actions', () => {
      it('should allow permitted file reads', async () => {
        const action: AgentAction = {
          type: 'file_read',
          path: 'src/index.ts',
        };

        await expect(
          enforcer.enforcePermission('implementer', 'project-1', action),
        ).resolves.not.toThrow();
      });

      it('should throw for denied file reads', async () => {
        const action: AgentAction = {
          type: 'file_read',
          path: '.env',
        };

        await expect(
          enforcer.enforcePermission('implementer', 'project-1', action),
        ).rejects.toThrow(PermissionDeniedError);
      });

      it('should allow permitted file writes', async () => {
        const action: AgentAction = {
          type: 'file_write',
          path: 'src/index.ts',
        };

        await expect(
          enforcer.enforcePermission('implementer', 'project-1', action),
        ).resolves.not.toThrow();
      });

      it('should throw for denied file writes', async () => {
        const action: AgentAction = {
          type: 'file_write',
          path: 'src/index.ts',
        };

        await expect(
          enforcer.enforcePermission('researcher', 'project-1', action),
        ).rejects.toThrow(PermissionDeniedError);
      });

      it('should throw error if path is missing', async () => {
        const action: AgentAction = {
          type: 'file_read',
        };

        await expect(
          enforcer.enforcePermission('implementer', 'project-1', action),
        ).rejects.toThrow('Path is required');
      });
    });

    describe('command actions', () => {
      it('should allow permitted commands', async () => {
        const action: AgentAction = {
          type: 'command',
          command: 'npm test',
        };

        await expect(
          enforcer.enforcePermission('implementer', 'project-1', action),
        ).resolves.not.toThrow();
      });

      it('should throw for denied commands', async () => {
        const action: AgentAction = {
          type: 'command',
          command: 'rm -rf /',
        };

        await expect(
          enforcer.enforcePermission('implementer', 'project-1', action),
        ).rejects.toThrow(PermissionDeniedError);
      });

      it('should throw error if command is missing', async () => {
        const action: AgentAction = {
          type: 'command',
        };

        await expect(
          enforcer.enforcePermission('implementer', 'project-1', action),
        ).rejects.toThrow('Command is required');
      });
    });

    describe('git actions', () => {
      it('should allow permitted git operations', async () => {
        const action: AgentAction = {
          type: 'git',
          operation: 'commit',
        };

        await expect(
          enforcer.enforcePermission('implementer', 'project-1', action),
        ).resolves.not.toThrow();
      });

      it('should throw for denied git operations', async () => {
        const action: AgentAction = {
          type: 'git',
          operation: 'force_push',
        };

        await expect(
          enforcer.enforcePermission('implementer', 'project-1', action),
        ).rejects.toThrow(PermissionDeniedError);
      });

      it('should throw error if operation is missing', async () => {
        const action: AgentAction = {
          type: 'git',
        };

        await expect(
          enforcer.enforcePermission('implementer', 'project-1', action),
        ).rejects.toThrow('Operation is required');
      });
    });

    describe('api actions', () => {
      it('should allow permitted API calls', async () => {
        const action: AgentAction = {
          type: 'api',
          apiUrl: 'https://api.github.com/repos/test/test',
        };

        await expect(
          enforcer.enforcePermission('implementer', 'project-1', action),
        ).resolves.not.toThrow();
      });

      it('should throw for denied API calls', async () => {
        const action: AgentAction = {
          type: 'api',
          apiUrl: 'http://localhost:3000/api',
        };

        await expect(
          enforcer.enforcePermission('implementer', 'project-1', action),
        ).rejects.toThrow(PermissionDeniedError);
      });

      it('should throw error if apiUrl is missing', async () => {
        const action: AgentAction = {
          type: 'api',
        };

        await expect(
          enforcer.enforcePermission('implementer', 'project-1', action),
        ).rejects.toThrow('API URL is required');
      });
    });

    describe('violation recording', () => {
      it('should record violations when enabled', async () => {
        const action: AgentAction = {
          type: 'tool',
          toolName: 'Bash',
        };

        try {
          await enforcer.enforcePermission('researcher', 'project-1', action);
        } catch {
          // Expected
        }

        const violations = await permissionService.getPermissionViolations();
        expect(violations.length).toBe(1);
        expect(violations[0]?.agentType).toBe('researcher');
      });

      it('should not record violations when disabled', async () => {
        const enforcerNoRecord = new PermissionEnforcer({
          permissionService,
          recordViolations: false,
        });

        const action: AgentAction = {
          type: 'tool',
          toolName: 'Bash',
        };

        try {
          await enforcerNoRecord.enforcePermission('researcher', 'project-1', action);
        } catch {
          // Expected
        }

        const violations = await permissionService.getPermissionViolations();
        expect(violations.length).toBe(0);
      });
    });

    describe('approval workflow', () => {
      it('should throw PermissionApprovalRequiredError when approval required', async () => {
        // Set up a tool that requires approval
        await permissionService.setProjectPermissions('project-1', 'implementer', {
          tools: {
            allowed: ['Read'],
            denied: [],
            requireApproval: ['Deploy'],
          },
        });

        const action: AgentAction = {
          type: 'tool',
          toolName: 'Deploy',
        };

        await expect(
          enforcer.enforcePermission('implementer', 'project-1', action),
        ).rejects.toThrow(PermissionApprovalRequiredError);
      });

      it('should include requestId in approval error', async () => {
        await permissionService.setProjectPermissions('project-1', 'implementer', {
          tools: {
            allowed: ['Read'],
            denied: [],
            requireApproval: ['Deploy'],
          },
        });

        const action: AgentAction = {
          type: 'tool',
          toolName: 'Deploy',
        };

        try {
          await enforcer.enforcePermission('implementer', 'project-1', action);
        } catch (error) {
          expect(error).toBeInstanceOf(PermissionApprovalRequiredError);
          expect((error as PermissionApprovalRequiredError).requestId).toBeDefined();
        }
      });
    });
  });

  describe('enforceResourceLimits', () => {
    it('should not throw when within limits', () => {
      expect(() =>
        enforcer.enforceResourceLimits('implementer', 'project-1', {
          maxFilesModified: 5,
          maxLinesChanged: 100,
        }),
      ).not.toThrow();
    });

    it('should throw ResourceLimitExceededError when exceeding limits', () => {
      expect(() =>
        enforcer.enforceResourceLimits('implementer', 'project-1', {
          maxFilesModified: 1000,
        }),
      ).toThrow(ResourceLimitExceededError);
    });

    it('should include resource details in error', () => {
      try {
        enforcer.enforceResourceLimits('implementer', 'project-1', {
          maxFilesModified: 1000,
        });
      } catch (error) {
        expect(error).toBeInstanceOf(ResourceLimitExceededError);
        const rle = error as ResourceLimitExceededError;
        expect(rle.resource).toBe('maxFilesModified');
        expect(rle.current).toBe(1000);
        expect(rle.limit).toBeDefined();
      }
    });
  });

  describe('wouldAllow', () => {
    it('should return true for allowed actions', async () => {
      const action: AgentAction = {
        type: 'tool',
        toolName: 'Read',
      };

      const result = await enforcer.wouldAllow('implementer', 'project-1', action);
      expect(result).toBe(true);
    });

    it('should return false for denied actions', async () => {
      const action: AgentAction = {
        type: 'tool',
        toolName: 'Bash',
      };

      const result = await enforcer.wouldAllow('researcher', 'project-1', action);
      expect(result).toBe(false);
    });

    it('should not record violations', async () => {
      const action: AgentAction = {
        type: 'tool',
        toolName: 'Bash',
      };

      await enforcer.wouldAllow('researcher', 'project-1', action);

      const violations = await permissionService.getPermissionViolations();
      expect(violations.length).toBe(0);
    });
  });

  describe('severity determination', () => {
    it('should mark force_push as critical', async () => {
      const action: AgentAction = {
        type: 'git',
        operation: 'force_push',
      };

      try {
        await enforcer.enforcePermission('implementer', 'project-1', action);
      } catch {
        // Expected
      }

      const violations = await permissionService.getPermissionViolations();
      expect(violations[0]?.severity).toBe('critical');
    });

    it('should mark dangerous commands as critical', async () => {
      const action: AgentAction = {
        type: 'command',
        command: 'sudo rm -rf /',
      };

      try {
        await enforcer.enforcePermission('implementer', 'project-1', action);
      } catch {
        // Expected
      }

      const violations = await permissionService.getPermissionViolations();
      expect(violations[0]?.severity).toBe('critical');
    });

    it('should mark sensitive file writes as high', async () => {
      const action: AgentAction = {
        type: 'file_write',
        path: '.env.production',
      };

      try {
        await enforcer.enforcePermission('implementer', 'project-1', action);
      } catch {
        // Expected
      }

      const violations = await permissionService.getPermissionViolations();
      expect(violations[0]?.severity).toBe('high');
    });
  });
});

describe('createPermissionEnforcer', () => {
  it('should create an enforcer', () => {
    const service = new PermissionService();
    const enforcer = createPermissionEnforcer({ permissionService: service });
    expect(enforcer).toBeInstanceOf(PermissionEnforcer);
  });
});

describe('createEnforcementMiddleware', () => {
  it('should create a middleware function', () => {
    const service = new PermissionService();
    const enforcer = new PermissionEnforcer({ permissionService: service });
    const middleware = createEnforcementMiddleware(enforcer);

    expect(typeof middleware).toBe('function');
  });

  it('should enforce permissions via middleware', async () => {
    const service = new PermissionService();
    const enforcer = new PermissionEnforcer({ permissionService: service });
    const middleware = createEnforcementMiddleware(enforcer);

    // Allowed action
    await expect(
      middleware('implementer', 'project-1', { type: 'tool', toolName: 'Read' }),
    ).resolves.not.toThrow();

    // Denied action
    await expect(
      middleware('researcher', 'project-1', { type: 'tool', toolName: 'Bash' }),
    ).rejects.toThrow(PermissionDeniedError);
  });
});

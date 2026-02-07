import { describe, it, expect, beforeEach } from 'vitest';
import { PermissionService, createPermissionService } from './permission-service.js';
import type { AgentType } from './types.js';

describe('PermissionService', () => {
  let service: PermissionService;

  beforeEach(() => {
    service = new PermissionService();
  });

  describe('checkToolPermission', () => {
    it('should allow tools in allowed list for implementer', () => {
      const result = service.checkToolPermission('implementer', 'project-1', 'Read');
      expect(result.allowed).toBe(true);
    });

    it('should allow all standard tools for implementer', () => {
      const tools = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'];

      for (const tool of tools) {
        const result = service.checkToolPermission('implementer', 'project-1', tool);
        expect(result.allowed).toBe(true);
      }
    });

    it('should deny write tools for researcher', () => {
      const result = service.checkToolPermission('researcher', 'project-1', 'Write');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Write');
    });

    it('should allow read-only tools for researcher', () => {
      const result = service.checkToolPermission('researcher', 'project-1', 'Read');
      expect(result.allowed).toBe(true);
    });

    it('should deny Bash for reviewer', () => {
      const result = service.checkToolPermission('reviewer', 'project-1', 'Bash');
      expect(result.allowed).toBe(false);
    });
  });

  describe('checkFilePermission', () => {
    it('should allow reading most files for implementer', () => {
      const result = service.checkFilePermission(
        'implementer',
        'project-1',
        'src/index.ts',
        'read',
      );
      expect(result.allowed).toBe(true);
    });

    it('should deny reading .env files', () => {
      const result = service.checkFilePermission(
        'implementer',
        'project-1',
        '.env',
        'read',
      );
      expect(result.allowed).toBe(false);
    });

    it('should deny reading secrets directory', () => {
      const result = service.checkFilePermission(
        'implementer',
        'project-1',
        'config/secrets/api-key.json',
        'read',
      );
      expect(result.allowed).toBe(false);
    });

    it('should allow writing to src for implementer', () => {
      const result = service.checkFilePermission(
        'implementer',
        'project-1',
        'src/components/Button.tsx',
        'write',
      );
      expect(result.allowed).toBe(true);
    });

    it('should deny writing to any file for researcher', () => {
      const result = service.checkFilePermission(
        'researcher',
        'project-1',
        'src/index.ts',
        'write',
      );
      expect(result.allowed).toBe(false);
    });

    it('should allow writing to docs for documenter', () => {
      const result = service.checkFilePermission(
        'documenter',
        'project-1',
        'docs/api.md',
        'write',
      );
      expect(result.allowed).toBe(true);
    });

    it('should deny writing to src for documenter', () => {
      const result = service.checkFilePermission(
        'documenter',
        'project-1',
        'src/index.ts',
        'write',
      );
      expect(result.allowed).toBe(false);
    });

    it('should allow writing to tests for tester', () => {
      const result = service.checkFilePermission(
        'tester',
        'project-1',
        'tests/unit/service.test.ts',
        'write',
      );
      expect(result.allowed).toBe(true);
    });
  });

  describe('checkCommandPermission', () => {
    it('should allow npm commands for implementer', () => {
      const result = service.checkCommandPermission(
        'implementer',
        'project-1',
        'npm test',
      );
      expect(result.allowed).toBe(true);
    });

    it('should allow git commands for implementer', () => {
      const result = service.checkCommandPermission(
        'implementer',
        'project-1',
        'git status',
      );
      expect(result.allowed).toBe(true);
    });

    it('should deny dangerous commands', () => {
      const result = service.checkCommandPermission(
        'implementer',
        'project-1',
        'rm -rf /',
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('dangerous');
    });

    it('should deny sudo commands', () => {
      const result = service.checkCommandPermission(
        'implementer',
        'project-1',
        'sudo apt update',
      );
      expect(result.allowed).toBe(false);
    });

    it('should deny all commands for researcher', () => {
      const result = service.checkCommandPermission(
        'researcher',
        'project-1',
        'npm test',
      );
      expect(result.allowed).toBe(false);
    });

    it('should allow test commands for tester', () => {
      const result = service.checkCommandPermission('tester', 'project-1', 'npm test');
      expect(result.allowed).toBe(true);
    });

    it('should deny install commands for tester', () => {
      const result = service.checkCommandPermission(
        'tester',
        'project-1',
        'npm install lodash',
      );
      expect(result.allowed).toBe(false);
    });
  });

  describe('checkGitPermission', () => {
    it('should allow commit for implementer', () => {
      const result = service.checkGitPermission('implementer', 'project-1', 'commit');
      expect(result.allowed).toBe(true);
    });

    it('should allow push for implementer', () => {
      const result = service.checkGitPermission('implementer', 'project-1', 'push');
      expect(result.allowed).toBe(true);
    });

    it('should allow create_branch for implementer', () => {
      const result = service.checkGitPermission(
        'implementer',
        'project-1',
        'create_branch',
      );
      expect(result.allowed).toBe(true);
    });

    it('should deny merge for implementer', () => {
      const result = service.checkGitPermission('implementer', 'project-1', 'merge');
      expect(result.allowed).toBe(false);
    });

    it('should deny force_push for implementer', () => {
      const result = service.checkGitPermission('implementer', 'project-1', 'force_push');
      expect(result.allowed).toBe(false);
    });

    it('should deny all git operations for reviewer', () => {
      const operations = ['commit', 'push', 'create_branch', 'merge'] as const;

      for (const op of operations) {
        const result = service.checkGitPermission('reviewer', 'project-1', op);
        expect(result.allowed).toBe(false);
      }
    });

    it('should block operations on protected branches', () => {
      const result = service.checkGitPermission(
        'implementer',
        'project-1',
        'push',
        'main',
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('protected');
    });

    it('should allow operations on feature branches', () => {
      const result = service.checkGitPermission(
        'implementer',
        'project-1',
        'push',
        'feature/new-feature',
      );
      expect(result.allowed).toBe(true);
    });
  });

  describe('checkAPIPermission', () => {
    it('should allow GitHub API', () => {
      const result = service.checkAPIPermission(
        'implementer',
        'project-1',
        'https://api.github.com/repos/test/test',
      );
      expect(result.allowed).toBe(true);
    });

    it('should deny localhost', () => {
      const result = service.checkAPIPermission(
        'implementer',
        'project-1',
        'http://localhost:3000/api',
      );
      expect(result.allowed).toBe(false);
    });
  });

  describe('checkResourceLimit', () => {
    it('should allow values within limits', () => {
      const result = service.checkResourceLimit(
        'implementer',
        'project-1',
        'maxFilesModified',
        10,
      );
      expect(result.allowed).toBe(true);
    });

    it('should deny values exceeding limits', () => {
      const result = service.checkResourceLimit(
        'implementer',
        'project-1',
        'maxFilesModified',
        100,
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('exceeded');
    });
  });

  describe('getEffectivePermissions', () => {
    it('should return default permissions for agent type', () => {
      const perms = service.getEffectivePermissions('implementer', 'project-1');

      expect(perms.agentType).toBe('implementer');
      expect(perms.tools.allowed).toContain('Write');
      expect(perms.tools.allowed).toContain('Bash');
    });

    it('should return different permissions for different agent types', () => {
      const implementerPerms = service.getEffectivePermissions(
        'implementer',
        'project-1',
      );
      const reviewerPerms = service.getEffectivePermissions('reviewer', 'project-1');

      expect(implementerPerms.tools.allowed).toContain('Write');
      expect(reviewerPerms.tools.denied).toContain('Write');
    });
  });

  describe('project permissions', () => {
    it('should allow setting project-level overrides', async () => {
      await service.setProjectPermissions('project-1', 'implementer', {
        resources: {
          maxFilesModified: 5,
          maxBudgetPerTask: 2.0,
          maxTokensPerTask: 50000,
          maxDurationMinutes: 30,
          maxLinesChanged: 500,
          maxConcurrentTasks: 1,
        },
      });

      const perms = service.getEffectivePermissions('implementer', 'project-1');
      expect(perms.resources.maxFilesModified).toBe(5);
    });

    it('should enforce more restrictive project limits', async () => {
      await service.setProjectPermissions('project-1', 'implementer', {
        resources: {
          maxFilesModified: 5,
          maxBudgetPerTask: 2.0,
          maxTokensPerTask: 50000,
          maxDurationMinutes: 30,
          maxLinesChanged: 500,
          maxConcurrentTasks: 1,
        },
      });

      const result = service.checkResourceLimit(
        'implementer',
        'project-1',
        'maxFilesModified',
        10,
      );
      expect(result.allowed).toBe(false);
    });
  });

  describe('permission requests', () => {
    it('should create a permission request', async () => {
      const result = await service.requestPermission({
        agentType: 'implementer',
        projectId: 'project-1',
        taskId: 'task-1',
        requestedPermission: {
          id: 'test',
          category: 'tool',
          resource: 'DangerousTool',
          action: 'allow',
        },
        reason: 'Need this for testing',
      });

      expect(result.approved).toBe(false);
      expect(result.requestId).toBeDefined();
    });

    it('should approve a pending request', async () => {
      const result = await service.requestPermission({
        agentType: 'implementer',
        projectId: 'project-1',
        taskId: 'task-1',
        requestedPermission: {
          id: 'test',
          category: 'tool',
          resource: 'DangerousTool',
          action: 'allow',
        },
        reason: 'Need this for testing',
      });

      await service.approvePermissionRequest(result.requestId, 'admin');

      const request = service.getPermissionRequest(result.requestId);
      expect(request?.status).toBe('approved');
    });

    it('should deny a pending request', async () => {
      const result = await service.requestPermission({
        agentType: 'implementer',
        projectId: 'project-1',
        taskId: 'task-1',
        requestedPermission: {
          id: 'test',
          category: 'tool',
          resource: 'DangerousTool',
          action: 'allow',
        },
        reason: 'Need this for testing',
      });

      await service.denyPermissionRequest(result.requestId, 'admin', 'Too risky');

      const request = service.getPermissionRequest(result.requestId);
      expect(request?.status).toBe('denied');
      expect(request?.resolutionReason).toBe('Too risky');
    });

    it('should list pending requests', async () => {
      await service.requestPermission({
        agentType: 'implementer',
        projectId: 'project-1',
        taskId: 'task-1',
        requestedPermission: {
          id: 'test',
          category: 'tool',
          resource: 'Tool1',
          action: 'allow',
        },
        reason: 'Test 1',
      });

      await service.requestPermission({
        agentType: 'reviewer',
        projectId: 'project-1',
        taskId: 'task-2',
        requestedPermission: {
          id: 'test2',
          category: 'tool',
          resource: 'Tool2',
          action: 'allow',
        },
        reason: 'Test 2',
      });

      const pending = await service.getPendingRequests();
      expect(pending.length).toBe(2);
    });
  });

  describe('violation recording', () => {
    it('should record violations', async () => {
      await service.recordViolation({
        agentType: 'researcher',
        projectId: 'project-1',
        taskId: 'task-1',
        action: { type: 'tool', toolName: 'Write' },
        deniedPermission: {
          id: 'test',
          category: 'tool',
          resource: 'Write',
          action: 'deny',
        },
        reason: 'Write not allowed for researcher',
        severity: 'medium',
        repeated: false,
      });

      const violations = await service.getPermissionViolations();
      expect(violations.length).toBe(1);
      expect(violations[0]?.agentType).toBe('researcher');
    });

    it('should filter violations by agent type', async () => {
      await service.recordViolation({
        agentType: 'researcher',
        projectId: 'project-1',
        action: { type: 'tool', toolName: 'Write' },
        deniedPermission: {
          id: 'test1',
          category: 'tool',
          resource: 'Write',
          action: 'deny',
        },
        reason: 'Test',
        severity: 'medium',
        repeated: false,
      });

      await service.recordViolation({
        agentType: 'reviewer',
        projectId: 'project-1',
        action: { type: 'tool', toolName: 'Bash' },
        deniedPermission: {
          id: 'test2',
          category: 'tool',
          resource: 'Bash',
          action: 'deny',
        },
        reason: 'Test',
        severity: 'medium',
        repeated: false,
      });

      const violations = await service.getPermissionViolations({
        agentType: 'researcher',
      });
      expect(violations.length).toBe(1);
    });
  });

  describe('cache', () => {
    it('should cache effective permissions', () => {
      // First call
      service.getEffectivePermissions('implementer', 'project-1');

      // Second call should hit cache
      const stats = service.getCacheStats();
      expect(stats.size).toBeGreaterThan(0);
    });

    it('should clear cache', () => {
      service.getEffectivePermissions('implementer', 'project-1');
      service.clearCache();

      const stats = service.getCacheStats();
      expect(stats.size).toBe(0);
    });
  });
});

describe('createPermissionService', () => {
  it('should create a service with default options', () => {
    const service = createPermissionService();
    expect(service).toBeInstanceOf(PermissionService);
  });

  it('should create a service with custom cache TTL', () => {
    const service = createPermissionService({ cacheTtlMs: 1000 });
    expect(service).toBeInstanceOf(PermissionService);
  });
});

describe('Agent Type Permissions', () => {
  const service = new PermissionService();

  const agentTypes: AgentType[] = [
    'scrum_master',
    'architect',
    'researcher',
    'analyst',
    'planner',
    'implementer',
    'reviewer',
    'tester',
    'documenter',
  ];

  for (const agentType of agentTypes) {
    describe(`${agentType}`, () => {
      it('should have defined permissions', () => {
        const perms = service.getEffectivePermissions(agentType, 'test');
        expect(perms).toBeDefined();
        expect(perms.agentType).toBe(agentType);
        expect(perms.tools).toBeDefined();
        expect(perms.files).toBeDefined();
        expect(perms.commands).toBeDefined();
        expect(perms.git).toBeDefined();
        expect(perms.resources).toBeDefined();
      });

      it('should always allow Read tool', () => {
        const result = service.checkToolPermission(agentType, 'test', 'Read');
        expect(result.allowed).toBe(true);
      });

      it('should always deny reading .env files', () => {
        const result = service.checkFilePermission(agentType, 'test', '.env', 'read');
        expect(result.allowed).toBe(false);
      });

      it('should always deny dangerous commands', () => {
        const result = service.checkCommandPermission(agentType, 'test', 'rm -rf /');
        expect(result.allowed).toBe(false);
      });
    });
  }
});

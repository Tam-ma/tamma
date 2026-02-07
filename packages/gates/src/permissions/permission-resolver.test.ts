import { describe, it, expect, beforeEach } from 'vitest';
import { PermissionResolver, createPermissionResolver } from './permission-resolver.js';
import { getDefaultPermissions } from './defaults.js';
import type { AgentPermissionSet } from './types.js';

describe('PermissionResolver', () => {
  let resolver: PermissionResolver;

  beforeEach(() => {
    resolver = new PermissionResolver();
  });

  describe('resolve', () => {
    it('should return global defaults when no project overrides', () => {
      const perms = resolver.resolve('implementer', 'project-1');

      expect(perms.agentType).toBe('implementer');
      expect(perms.scope).toBe('global');
    });

    it('should merge project overrides with global', () => {
      // Set global permissions first
      const globalPerms = getDefaultPermissions('implementer');
      resolver.setGlobalPermissions('implementer', globalPerms);

      // Add project overrides
      resolver.setProjectPermissions('project-1', 'implementer', {
        tools: {
          allowed: ['CustomTool'],
          denied: [],
          requireApproval: [],
        },
      });

      const perms = resolver.resolve('implementer', 'project-1');

      expect(perms.scope).toBe('project');
      expect(perms.tools.allowed).toContain('CustomTool');
      // Should still have global defaults
      expect(perms.tools.allowed).toContain('Read');
    });

    it('should cache resolved permissions', () => {
      resolver.resolve('implementer', 'project-1');
      resolver.resolve('implementer', 'project-1');

      const stats = resolver.getCacheStats();
      expect(stats.size).toBe(1);
    });

    it('should invalidate cache on permission updates', () => {
      resolver.resolve('implementer', 'project-1');

      resolver.setProjectPermissions('project-1', 'implementer', {
        scopeId: 'project-1',
      });

      // Cache should be invalidated
      const stats = resolver.getCacheStats();
      expect(stats.entries.includes('implementer:project-1')).toBe(false);
    });
  });

  describe('mergePermissions', () => {
    it('should merge tool permissions as union', () => {
      const global: AgentPermissionSet = {
        ...getDefaultPermissions('implementer'),
        tools: {
          allowed: ['Read', 'Write'],
          denied: ['Bash'],
          requireApproval: [],
        },
      };

      const merged = resolver.mergePermissions(global, {
        tools: {
          allowed: ['Edit', 'Glob'],
          denied: ['Shell'],
          requireApproval: ['Deploy'],
        },
      });

      expect(merged.tools.allowed).toContain('Read');
      expect(merged.tools.allowed).toContain('Edit');
      expect(merged.tools.denied).toContain('Bash');
      expect(merged.tools.denied).toContain('Shell');
      expect(merged.tools.requireApproval).toContain('Deploy');
    });

    it('should merge file permissions', () => {
      const global: AgentPermissionSet = {
        ...getDefaultPermissions('implementer'),
        files: {
          read: {
            allowed: ['src/**/*'],
            denied: ['**/.env'],
          },
          write: {
            allowed: ['src/**/*'],
            denied: ['package.json'],
          },
        },
      };

      const merged = resolver.mergePermissions(global, {
        files: {
          read: {
            allowed: ['lib/**/*'],
            denied: ['**/secrets/**'],
          },
          write: {
            allowed: [],
            denied: [],
          },
        },
      });

      expect(merged.files.read.allowed).toContain('src/**/*');
      expect(merged.files.read.allowed).toContain('lib/**/*');
      expect(merged.files.read.denied).toContain('**/.env');
      expect(merged.files.read.denied).toContain('**/secrets/**');
    });

    it('should take minimum for resource limits', () => {
      const global: AgentPermissionSet = {
        ...getDefaultPermissions('implementer'),
        resources: {
          maxTokensPerTask: 100000,
          maxBudgetPerTask: 10.0,
          maxDurationMinutes: 60,
          maxFilesModified: 50,
          maxLinesChanged: 2000,
          maxConcurrentTasks: 2,
        },
      };

      const merged = resolver.mergePermissions(global, {
        resources: {
          maxTokensPerTask: 50000, // More restrictive
          maxBudgetPerTask: 5.0, // More restrictive
          maxDurationMinutes: 120, // Less restrictive - should use global
          maxFilesModified: 20, // More restrictive
          maxLinesChanged: 1000, // More restrictive
          maxConcurrentTasks: 1, // More restrictive
        },
      });

      expect(merged.resources.maxTokensPerTask).toBe(50000);
      expect(merged.resources.maxBudgetPerTask).toBe(5.0);
      expect(merged.resources.maxDurationMinutes).toBe(60); // Global is more restrictive
      expect(merged.resources.maxFilesModified).toBe(20);
    });

    it('should merge git permissions with boolean overrides', () => {
      const global: AgentPermissionSet = {
        ...getDefaultPermissions('implementer'),
        git: {
          canCommit: true,
          canPush: true,
          canCreateBranch: true,
          canMerge: false,
          canDeleteBranch: false,
          canRebase: false,
          canForcePush: false,
          protectedBranches: ['main'],
        },
      };

      const merged = resolver.mergePermissions(global, {
        git: {
          canCommit: true,
          canPush: false, // Override to false
          canCreateBranch: true,
          canMerge: true, // Override to true
          canDeleteBranch: false,
          canRebase: false,
          canForcePush: false,
          protectedBranches: ['release/*'],
        },
      });

      expect(merged.git.canCommit).toBe(true);
      expect(merged.git.canPush).toBe(false); // Project override
      expect(merged.git.canMerge).toBe(true); // Project override
      expect(merged.git.protectedBranches).toContain('main');
      expect(merged.git.protectedBranches).toContain('release/*');
    });

    it('should handle undefined override fields gracefully', () => {
      const global = getDefaultPermissions('implementer');
      const merged = resolver.mergePermissions(global, {});

      expect(merged.tools).toEqual(global.tools);
      expect(merged.files).toEqual(global.files);
      expect(merged.commands).toEqual(global.commands);
      expect(merged.git).toEqual(global.git);
      expect(merged.resources).toEqual(global.resources);
    });
  });

  describe('setGlobalPermissions / getGlobalPermissions', () => {
    it('should store and retrieve global permissions', () => {
      const perms = getDefaultPermissions('implementer');
      resolver.setGlobalPermissions('implementer', perms);

      const retrieved = resolver.getGlobalPermissions('implementer');
      expect(retrieved).toEqual(perms);
    });

    it('should return undefined for unset agent types', () => {
      const retrieved = resolver.getGlobalPermissions('architect');
      expect(retrieved).toBeUndefined();
    });
  });

  describe('setProjectPermissions / getProjectPermissions', () => {
    it('should store and retrieve project permissions', () => {
      const overrides = {
        tools: {
          allowed: ['CustomTool'],
          denied: [],
          requireApproval: [],
        },
      };

      resolver.setProjectPermissions('project-1', 'implementer', overrides);

      const retrieved = resolver.getProjectPermissions('project-1', 'implementer');
      expect(retrieved).toEqual(overrides);
    });

    it('should return undefined for unset projects', () => {
      const retrieved = resolver.getProjectPermissions('unknown', 'implementer');
      expect(retrieved).toBeUndefined();
    });
  });

  describe('clearProjectPermissions', () => {
    it('should clear permissions for a specific agent type', () => {
      resolver.setProjectPermissions('project-1', 'implementer', { scopeId: 'p1' });
      resolver.setProjectPermissions('project-1', 'reviewer', { scopeId: 'p1' });

      resolver.clearProjectPermissions('project-1', 'implementer');

      expect(resolver.getProjectPermissions('project-1', 'implementer')).toBeUndefined();
      expect(resolver.getProjectPermissions('project-1', 'reviewer')).toBeDefined();
    });

    it('should clear all permissions for a project', () => {
      resolver.setProjectPermissions('project-1', 'implementer', { scopeId: 'p1' });
      resolver.setProjectPermissions('project-1', 'reviewer', { scopeId: 'p1' });

      resolver.clearProjectPermissions('project-1');

      expect(resolver.getProjectPermissions('project-1', 'implementer')).toBeUndefined();
      expect(resolver.getProjectPermissions('project-1', 'reviewer')).toBeUndefined();
    });
  });

  describe('cache management', () => {
    it('should clear cache', () => {
      resolver.resolve('implementer', 'project-1');
      resolver.resolve('reviewer', 'project-2');

      resolver.clearCache();

      const stats = resolver.getCacheStats();
      expect(stats.size).toBe(0);
    });

    it('should invalidate cache for agent type', () => {
      resolver.resolve('implementer', 'project-1');
      resolver.resolve('implementer', 'project-2');
      resolver.resolve('reviewer', 'project-1');

      const globalPerms = getDefaultPermissions('implementer');
      resolver.setGlobalPermissions('implementer', globalPerms);

      const stats = resolver.getCacheStats();
      // Only reviewer:project-1 should remain
      expect(stats.entries).not.toContain('implementer:project-1');
      expect(stats.entries).not.toContain('implementer:project-2');
    });
  });
});

describe('createPermissionResolver', () => {
  it('should create a resolver with default cache TTL', () => {
    const resolver = createPermissionResolver();
    expect(resolver).toBeInstanceOf(PermissionResolver);
  });

  it('should create a resolver with custom cache TTL', () => {
    const resolver = createPermissionResolver(1000);
    expect(resolver).toBeInstanceOf(PermissionResolver);
  });
});

/**
 * Permission resolver for merging global and project-level permissions
 * @module @tamma/gates/permissions/permission-resolver
 */

import type {
  AgentType,
  AgentPermissionSet,
  IPermissionResolver,
  ToolPermissions,
  FilePermissions,
  CommandPermissions,
  APIPermissions,
  GitPermissions,
  ResourceLimits,
} from './types.js';
import { getDefaultPermissions } from './defaults.js';

/**
 * Cache entry for resolved permissions
 */
interface CacheEntry {
  permissions: AgentPermissionSet;
  timestamp: number;
}

/**
 * Resolver for combining global defaults with project-level overrides
 *
 * Resolution Rules:
 * - Global permissions serve as defaults
 * - Project permissions can override (more permissive or restrictive)
 * - Denied patterns always take precedence over allowed
 * - Resource limits: project can only be more restrictive, not more permissive
 */
export class PermissionResolver implements IPermissionResolver {
  private readonly globalPermissions: Map<AgentType, AgentPermissionSet>;
  private readonly projectPermissions: Map<string, Map<AgentType, Partial<AgentPermissionSet>>>;
  private readonly cache: Map<string, CacheEntry>;
  private readonly cacheTtlMs: number;

  constructor(cacheTtlMs = 5 * 60 * 1000) {
    // 5 minutes default
    this.globalPermissions = new Map();
    this.projectPermissions = new Map();
    this.cache = new Map();
    this.cacheTtlMs = cacheTtlMs;
  }

  /**
   * Resolve effective permissions for an agent in a project
   */
  resolve(agentType: AgentType, projectId: string): AgentPermissionSet {
    const cacheKey = `${agentType}:${projectId}`;

    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) {
      return cached.permissions;
    }

    // Get global permissions (use defaults if not set)
    const global = this.globalPermissions.get(agentType) ?? getDefaultPermissions(agentType);

    // Get project overrides
    const projectOverrides = this.projectPermissions.get(projectId)?.get(agentType);

    // Merge if there are project overrides
    const resolved = projectOverrides ? this.mergePermissions(global, projectOverrides) : { ...global };

    // Update resolved permission metadata
    resolved.scope = projectOverrides ? 'project' : 'global';
    resolved.scopeId = projectId;

    // Cache the result
    this.cache.set(cacheKey, { permissions: resolved, timestamp: Date.now() });

    return resolved;
  }

  /**
   * Merge global permissions with project overrides
   */
  mergePermissions(
    global: AgentPermissionSet,
    projectOverrides: Partial<AgentPermissionSet>,
  ): AgentPermissionSet {
    return {
      agentType: global.agentType,
      scope: 'project',
      scopeId: projectOverrides.scopeId,
      tools: this.mergeToolPermissions(global.tools, projectOverrides.tools),
      files: this.mergeFilePermissions(global.files, projectOverrides.files),
      commands: this.mergeCommandPermissions(global.commands, projectOverrides.commands),
      apis: this.mergeAPIPermissions(global.apis, projectOverrides.apis),
      git: this.mergeGitPermissions(global.git, projectOverrides.git),
      resources: this.mergeResourceLimits(global.resources, projectOverrides.resources),
      createdAt: projectOverrides.createdAt ?? global.createdAt,
      updatedAt: projectOverrides.updatedAt ?? global.updatedAt,
      createdBy: projectOverrides.createdBy ?? global.createdBy,
    };
  }

  /**
   * Merge tool permissions
   * Project overrides can add or remove tools from lists
   */
  private mergeToolPermissions(
    global: ToolPermissions,
    override?: Partial<ToolPermissions>,
  ): ToolPermissions {
    if (!override) return { ...global };

    return {
      allowed: this.mergeStringArrays(global.allowed, override.allowed),
      denied: this.mergeStringArrays(global.denied, override.denied),
      requireApproval: this.mergeStringArrays(global.requireApproval, override.requireApproval),
    };
  }

  /**
   * Merge file permissions
   * Project overrides can add additional patterns
   */
  private mergeFilePermissions(
    global: FilePermissions,
    override?: Partial<FilePermissions>,
  ): FilePermissions {
    if (!override) return { ...global };

    return {
      read: {
        allowed: this.mergeStringArrays(global.read.allowed, override.read?.allowed),
        denied: this.mergeStringArrays(global.read.denied, override.read?.denied),
      },
      write: {
        allowed: this.mergeStringArrays(global.write.allowed, override.write?.allowed),
        denied: this.mergeStringArrays(global.write.denied, override.write?.denied),
      },
    };
  }

  /**
   * Merge command permissions
   */
  private mergeCommandPermissions(
    global: CommandPermissions,
    override?: Partial<CommandPermissions>,
  ): CommandPermissions {
    if (!override) return { ...global };

    return {
      allowed: this.mergeStringArrays(global.allowed, override.allowed),
      denied: this.mergeStringArrays(global.denied, override.denied),
      patterns: {
        allow: this.mergeStringArrays(global.patterns.allow, override.patterns?.allow),
        deny: this.mergeStringArrays(global.patterns.deny, override.patterns?.deny),
      },
    };
  }

  /**
   * Merge API permissions
   */
  private mergeAPIPermissions(
    global: APIPermissions,
    override?: Partial<APIPermissions>,
  ): APIPermissions {
    if (!override) return { ...global };

    return {
      allowed: this.mergeStringArrays(global.allowed, override.allowed),
      denied: this.mergeStringArrays(global.denied, override.denied),
      requireApproval: this.mergeStringArrays(global.requireApproval, override.requireApproval),
    };
  }

  /**
   * Merge git permissions
   * Boolean permissions: project override wins if defined
   * Protected branches: union of both lists
   */
  private mergeGitPermissions(
    global: GitPermissions,
    override?: Partial<GitPermissions>,
  ): GitPermissions {
    if (!override) return { ...global };

    return {
      canCommit: override.canCommit ?? global.canCommit,
      canPush: override.canPush ?? global.canPush,
      canCreateBranch: override.canCreateBranch ?? global.canCreateBranch,
      canMerge: override.canMerge ?? global.canMerge,
      canDeleteBranch: override.canDeleteBranch ?? global.canDeleteBranch,
      canRebase: override.canRebase ?? global.canRebase,
      canForcePush: override.canForcePush ?? global.canForcePush,
      protectedBranches: this.mergeStringArrays(
        global.protectedBranches,
        override.protectedBranches,
      ),
    };
  }

  /**
   * Merge resource limits
   * Project can only be MORE restrictive (lower limits), never more permissive
   */
  private mergeResourceLimits(
    global: ResourceLimits,
    override?: Partial<ResourceLimits>,
  ): ResourceLimits {
    if (!override) return { ...global };

    return {
      maxTokensPerTask: Math.min(
        global.maxTokensPerTask,
        override.maxTokensPerTask ?? global.maxTokensPerTask,
      ),
      maxBudgetPerTask: Math.min(
        global.maxBudgetPerTask,
        override.maxBudgetPerTask ?? global.maxBudgetPerTask,
      ),
      maxDurationMinutes: Math.min(
        global.maxDurationMinutes,
        override.maxDurationMinutes ?? global.maxDurationMinutes,
      ),
      maxFilesModified: Math.min(
        global.maxFilesModified,
        override.maxFilesModified ?? global.maxFilesModified,
      ),
      maxLinesChanged: Math.min(
        global.maxLinesChanged,
        override.maxLinesChanged ?? global.maxLinesChanged,
      ),
      maxConcurrentTasks: Math.min(
        global.maxConcurrentTasks,
        override.maxConcurrentTasks ?? global.maxConcurrentTasks,
      ),
    };
  }

  /**
   * Merge string arrays (union with deduplication)
   */
  private mergeStringArrays(base: string[], override?: string[]): string[] {
    if (!override || override.length === 0) return [...base];
    return [...new Set([...base, ...override])];
  }

  /**
   * Set global permissions for an agent type
   */
  setGlobalPermissions(agentType: AgentType, permissions: AgentPermissionSet): void {
    this.globalPermissions.set(agentType, permissions);
    this.invalidateCacheForAgent(agentType);
  }

  /**
   * Get global permissions for an agent type
   */
  getGlobalPermissions(agentType: AgentType): AgentPermissionSet | undefined {
    return this.globalPermissions.get(agentType);
  }

  /**
   * Set project-level permission overrides
   */
  setProjectPermissions(
    projectId: string,
    agentType: AgentType,
    overrides: Partial<AgentPermissionSet>,
  ): void {
    let projectMap = this.projectPermissions.get(projectId);
    if (!projectMap) {
      projectMap = new Map();
      this.projectPermissions.set(projectId, projectMap);
    }
    projectMap.set(agentType, overrides);
    this.invalidateCacheForProject(projectId);
  }

  /**
   * Get project-level permission overrides
   */
  getProjectPermissions(
    projectId: string,
    agentType: AgentType,
  ): Partial<AgentPermissionSet> | undefined {
    return this.projectPermissions.get(projectId)?.get(agentType);
  }

  /**
   * Clear project-level permission overrides
   */
  clearProjectPermissions(projectId: string, agentType?: AgentType): void {
    if (agentType) {
      this.projectPermissions.get(projectId)?.delete(agentType);
    } else {
      this.projectPermissions.delete(projectId);
    }
    this.invalidateCacheForProject(projectId);
  }

  /**
   * Invalidate cache entries for an agent type
   */
  private invalidateCacheForAgent(agentType: AgentType): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${agentType}:`)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Invalidate cache entries for a project
   */
  private invalidateCacheForProject(projectId: string): void {
    for (const key of this.cache.keys()) {
      if (key.endsWith(`:${projectId}`)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear entire cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; entries: string[] } {
    return {
      size: this.cache.size,
      entries: [...this.cache.keys()],
    };
  }
}

/**
 * Create a permission resolver with default configuration
 */
export function createPermissionResolver(cacheTtlMs?: number): PermissionResolver {
  return new PermissionResolver(cacheTtlMs);
}

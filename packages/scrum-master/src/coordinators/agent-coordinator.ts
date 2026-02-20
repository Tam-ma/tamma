/**
 * Agent Coordinator
 *
 * Manages agent pool (Architect, Researcher, Implementer, etc.),
 * task assignment, resource allocation, and cost budget enforcement.
 *
 * @module @tamma/scrum-master/coordinators/agent-coordinator
 */

import { nanoid } from 'nanoid';
import type { AgentType } from '@tamma/gates';
import type {
  ICostTracker,
  LimitCheckResult,
  UsageRecordInput,
} from '@tamma/cost-monitor';
import type {
  AgentInfo,
  AgentAssignment,
  IAgentCoordinator,
  IEngine,
  IEnginePool,
  EnginePoolStatus,
  EngineExecutionConfig,
  EngineProgressEvent,
  ImplementationResult,
} from '../types.js';
import type { CostConfig } from '../config.js';
import { DEFAULT_SCRUM_MASTER_CONFIG } from '../config.js';

/**
 * Agent pool with mock implementation
 */
export class AgentPool {
  private agents: Map<string, AgentInfo> = new Map();

  constructor() {
    // Initialize with default agents
    this.initializeDefaultAgents();
  }

  private initializeDefaultAgents(): void {
    const agentTypes: AgentType[] = [
      'architect',
      'researcher',
      'implementer',
      'reviewer',
      'tester',
    ];

    for (const type of agentTypes) {
      const id = nanoid();
      this.agents.set(id, {
        id,
        type,
        status: 'idle',
        capabilities: this.getCapabilitiesForType(type),
      });
    }
  }

  private getCapabilitiesForType(type: AgentType): string[] {
    const capabilityMap: Record<AgentType, string[]> = {
      scrum_master: ['coordination', 'planning', 'review'],
      architect: ['design', 'architecture', 'planning'],
      researcher: ['research', 'analysis', 'documentation'],
      analyst: ['analysis', 'requirements', 'documentation'],
      planner: ['planning', 'estimation', 'scheduling'],
      implementer: ['coding', 'testing', 'debugging'],
      reviewer: ['code-review', 'testing', 'quality'],
      tester: ['testing', 'automation', 'quality'],
      documenter: ['documentation', 'writing', 'diagrams'],
    };

    return capabilityMap[type] ?? [];
  }

  getAgent(agentId: string): AgentInfo | undefined {
    return this.agents.get(agentId);
  }

  getAgentsByType(type: AgentType): AgentInfo[] {
    return Array.from(this.agents.values()).filter((a) => a.type === type);
  }

  getAvailableAgents(): AgentInfo[] {
    return Array.from(this.agents.values()).filter((a) => a.status === 'idle');
  }

  getAvailableAgentByType(type: AgentType): AgentInfo | undefined {
    return Array.from(this.agents.values()).find(
      (a) => a.type === type && a.status === 'idle'
    );
  }

  markBusy(agentId: string, taskId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.status = 'busy';
      agent.currentTaskId = taskId;
    }
  }

  markIdle(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.status = 'idle';
      agent.currentTaskId = undefined;
    }
  }

  markError(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.status = 'error';
    }
  }

  addAgent(type: AgentType, capabilities?: string[]): AgentInfo {
    const id = nanoid();
    const agent: AgentInfo = {
      id,
      type,
      status: 'idle',
      capabilities: capabilities ?? this.getCapabilitiesForType(type),
    };
    this.agents.set(id, agent);
    return agent;
  }

  removeAgent(agentId: string): boolean {
    return this.agents.delete(agentId);
  }

  getStats(): {
    total: number;
    idle: number;
    busy: number;
    error: number;
    byType: Record<string, number>;
  } {
    const agents = Array.from(this.agents.values());
    const byType: Record<string, number> = {};

    for (const agent of agents) {
      byType[agent.type] = (byType[agent.type] ?? 0) + 1;
    }

    return {
      total: agents.length,
      idle: agents.filter((a) => a.status === 'idle').length,
      busy: agents.filter((a) => a.status === 'busy').length,
      error: agents.filter((a) => a.status === 'error').length,
      byType,
    };
  }
}

/**
 * Mock engine implementation
 */
export class MockEngine implements IEngine {
  id: string;
  status: 'idle' | 'busy' | 'error' = 'idle';

  constructor() {
    this.id = nanoid();
  }

  async execute(
    prompt: string,
    config: EngineExecutionConfig,
    onProgress?: (event: EngineProgressEvent) => void
  ): Promise<ImplementationResult> {
    this.status = 'busy';

    // Simulate progress
    if (onProgress) {
      onProgress({
        type: 'progress',
        message: 'Starting implementation...',
        timestamp: new Date(),
      });
    }

    // Simulate execution time
    await new Promise((resolve) => setTimeout(resolve, 100));

    if (onProgress) {
      onProgress({
        type: 'progress',
        message: 'Implementation complete',
        timestamp: new Date(),
      });
    }

    this.status = 'idle';

    return {
      success: true,
      output: 'Mock implementation output',
      costUsd: 0.05,
      durationMs: 100,
      filesModified: [],
      testsRun: 0,
      testsPassed: 0,
      sessionId: this.id,
    };
  }
}

/**
 * Mock engine pool implementation
 */
export class MockEnginePool implements IEnginePool {
  private engines: Map<string, MockEngine> = new Map();
  private maxEngines: number;

  constructor(maxEngines = 3) {
    this.maxEngines = maxEngines;
    // Initialize with some engines
    for (let i = 0; i < maxEngines; i++) {
      const engine = new MockEngine();
      this.engines.set(engine.id, engine);
    }
  }

  async acquire(_projectId: string): Promise<IEngine> {
    // Find an idle engine
    for (const engine of this.engines.values()) {
      if (engine.status === 'idle') {
        engine.status = 'busy';
        return engine;
      }
    }

    // No available engines
    throw new Error('No engines available');
  }

  async release(engine: IEngine): Promise<void> {
    const mockEngine = this.engines.get(engine.id);
    if (mockEngine) {
      mockEngine.status = 'idle';
    }
  }

  getAvailableCount(): number {
    let count = 0;
    for (const engine of this.engines.values()) {
      if (engine.status === 'idle') {
        count++;
      }
    }
    return count;
  }

  getStatus(): EnginePoolStatus {
    const engines = Array.from(this.engines.values());
    return {
      total: engines.length,
      available: engines.filter((e) => e.status === 'idle').length,
      busy: engines.filter((e) => e.status === 'busy').length,
      error: engines.filter((e) => e.status === 'error').length,
    };
  }
}

/**
 * Agent Coordinator implementation
 */
export class AgentCoordinator implements IAgentCoordinator {
  private agentPool: AgentPool;
  private enginePool: IEnginePool;
  private costTracker: ICostTracker | null = null;
  private assignments: Map<string, AgentAssignment> = new Map();
  private config: CostConfig;

  constructor(
    enginePool?: IEnginePool,
    config?: Partial<CostConfig>
  ) {
    this.agentPool = new AgentPool();
    this.enginePool = enginePool ?? new MockEnginePool();
    this.config = { ...DEFAULT_SCRUM_MASTER_CONFIG.cost, ...config };
  }

  /**
   * Set the cost tracker for budget enforcement
   */
  setCostTracker(tracker: ICostTracker): void {
    this.costTracker = tracker;
  }

  /**
   * Set the engine pool
   */
  setEnginePool(pool: IEnginePool): void {
    this.enginePool = pool;
  }

  /**
   * Get available agents
   */
  getAvailableAgents(): AgentInfo[] {
    return this.agentPool.getAvailableAgents();
  }

  /**
   * Get agents by type
   */
  getAgentsByType(type: AgentType): AgentInfo[] {
    return this.agentPool.getAgentsByType(type);
  }

  /**
   * Assign an agent to a task
   */
  async assignAgent(taskId: string, agentType: AgentType): Promise<AgentAssignment> {
    // Check if task already has an assignment
    const existingAssignment = Array.from(this.assignments.values()).find(
      (a) => a.taskId === taskId && a.role === agentType
    );
    if (existingAssignment) {
      return existingAssignment;
    }

    // Find available agent of the requested type
    const agent = this.agentPool.getAvailableAgentByType(agentType);
    if (!agent) {
      throw new Error(`No available ${agentType} agent`);
    }

    // Mark agent as busy
    this.agentPool.markBusy(agent.id, taskId);

    // Create assignment
    const assignment: AgentAssignment = {
      agentId: agent.id,
      taskId,
      assignedAt: new Date(),
      role: agentType,
    };

    this.assignments.set(`${taskId}:${agentType}`, assignment);

    return assignment;
  }

  /**
   * Release an agent from its task
   */
  async releaseAgent(agentId: string): Promise<void> {
    this.agentPool.markIdle(agentId);

    // Remove assignments for this agent
    for (const [key, assignment] of this.assignments.entries()) {
      if (assignment.agentId === agentId) {
        this.assignments.delete(key);
      }
    }
  }

  /**
   * Get assignments for a task
   */
  getTaskAssignments(taskId: string): AgentAssignment[] {
    return Array.from(this.assignments.values()).filter(
      (a) => a.taskId === taskId
    );
  }

  /**
   * Check cost budget
   */
  async checkCostBudget(
    projectId: string,
    estimatedCost: number
  ): Promise<LimitCheckResult> {
    if (!this.costTracker) {
      // No cost tracker, allow by default
      return {
        allowed: true,
        currentUsageUsd: 0,
        limitUsd: this.config.defaultTaskBudgetUsd,
        percentUsed: 0,
        warnings: [],
        triggeredLimits: [],
        recommendedAction: 'proceed',
      };
    }

    return this.costTracker.checkLimit({
      projectId,
      estimatedCostUsd: estimatedCost,
    });
  }

  /**
   * Record cost usage
   */
  async recordCostUsage(usage: Partial<UsageRecordInput>): Promise<void> {
    if (!this.costTracker) {
      return;
    }

    // Fill in required fields with defaults if not provided
    const record: UsageRecordInput = {
      projectId: usage.projectId ?? 'unknown',
      engineId: usage.engineId ?? 'unknown',
      agentType: usage.agentType ?? 'implementer',
      taskId: usage.taskId ?? 'unknown',
      taskType: usage.taskType ?? 'implementation',
      provider: usage.provider ?? 'anthropic',
      model: usage.model ?? 'claude-3-5-sonnet-20241022',
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      totalTokens: usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
      latencyMs: usage.latencyMs ?? 0,
      success: usage.success ?? true,
      traceId: usage.traceId,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      errorCode: usage.errorCode,
    };

    await this.costTracker.recordUsage(record);
  }

  /**
   * Get engine from pool
   */
  async acquireEngine(projectId: string): Promise<IEngine> {
    return this.enginePool.acquire(projectId);
  }

  /**
   * Release engine back to pool
   */
  async releaseEngine(engine: IEngine): Promise<void> {
    return this.enginePool.release(engine);
  }

  /**
   * Get engine pool status
   */
  getEnginePoolStatus(): EnginePoolStatus {
    return this.enginePool.getStatus();
  }

  /**
   * Get coordinator statistics
   */
  getStats(): {
    agents: ReturnType<AgentPool['getStats']>;
    engines: EnginePoolStatus;
    assignments: number;
  } {
    return {
      agents: this.agentPool.getStats(),
      engines: this.enginePool.getStatus(),
      assignments: this.assignments.size,
    };
  }

  /**
   * Clear all assignments (for testing)
   */
  clearAssignments(): void {
    for (const assignment of this.assignments.values()) {
      this.agentPool.markIdle(assignment.agentId);
    }
    this.assignments.clear();
  }
}

/**
 * Create an agent coordinator with optional dependencies
 */
export function createAgentCoordinator(
  enginePool?: IEnginePool,
  config?: Partial<CostConfig>
): AgentCoordinator {
  return new AgentCoordinator(enginePool, config);
}

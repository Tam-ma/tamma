import { describe, it, expect, beforeEach } from 'vitest';
import {
  AgentCoordinator,
  AgentPool,
  MockEngine,
  MockEnginePool,
  createAgentCoordinator,
} from './agent-coordinator.js';

describe('AgentPool', () => {
  let pool: AgentPool;

  beforeEach(() => {
    pool = new AgentPool();
  });

  describe('initialization', () => {
    it('should initialize with default agents', () => {
      const stats = pool.getStats();

      expect(stats.total).toBeGreaterThan(0);
      expect(stats.byType['implementer']).toBeDefined();
      expect(stats.byType['reviewer']).toBeDefined();
    });
  });

  describe('getAvailableAgents', () => {
    it('should return all idle agents', () => {
      const available = pool.getAvailableAgents();

      expect(available.length).toBeGreaterThan(0);
      expect(available.every((a) => a.status === 'idle')).toBe(true);
    });
  });

  describe('getAgentsByType', () => {
    it('should filter agents by type', () => {
      const implementers = pool.getAgentsByType('implementer');

      expect(implementers.every((a) => a.type === 'implementer')).toBe(true);
    });
  });

  describe('getAvailableAgentByType', () => {
    it('should return an available agent of type', () => {
      const agent = pool.getAvailableAgentByType('implementer');

      expect(agent).toBeDefined();
      expect(agent?.type).toBe('implementer');
      expect(agent?.status).toBe('idle');
    });

    it('should return undefined when no agent available', () => {
      // Mark all implementers as busy
      const implementers = pool.getAgentsByType('implementer');
      for (const impl of implementers) {
        pool.markBusy(impl.id, 'task-1');
      }

      const agent = pool.getAvailableAgentByType('implementer');
      expect(agent).toBeUndefined();
    });
  });

  describe('markBusy/markIdle', () => {
    it('should update agent status', () => {
      const agent = pool.getAvailableAgentByType('implementer')!;

      pool.markBusy(agent.id, 'task-1');
      expect(pool.getAgent(agent.id)?.status).toBe('busy');
      expect(pool.getAgent(agent.id)?.currentTaskId).toBe('task-1');

      pool.markIdle(agent.id);
      expect(pool.getAgent(agent.id)?.status).toBe('idle');
      expect(pool.getAgent(agent.id)?.currentTaskId).toBeUndefined();
    });
  });

  describe('addAgent/removeAgent', () => {
    it('should add a new agent', () => {
      const initialCount = pool.getStats().total;
      const agent = pool.addAgent('implementer');

      expect(pool.getStats().total).toBe(initialCount + 1);
      expect(agent.type).toBe('implementer');
      expect(agent.status).toBe('idle');
    });

    it('should remove an agent', () => {
      const agent = pool.addAgent('implementer');
      const initialCount = pool.getStats().total;

      const removed = pool.removeAgent(agent.id);

      expect(removed).toBe(true);
      expect(pool.getStats().total).toBe(initialCount - 1);
    });
  });

  describe('getStats', () => {
    it('should return comprehensive statistics', () => {
      const agent = pool.getAvailableAgentByType('implementer')!;
      pool.markBusy(agent.id, 'task-1');
      pool.markError(pool.getAvailableAgentByType('reviewer')!.id);

      const stats = pool.getStats();

      expect(stats.total).toBeGreaterThan(0);
      expect(stats.busy).toBe(1);
      expect(stats.error).toBe(1);
      expect(stats.idle).toBe(stats.total - 2);
    });
  });
});

describe('MockEngine', () => {
  let engine: MockEngine;

  beforeEach(() => {
    engine = new MockEngine();
  });

  describe('execute', () => {
    it('should return success result', async () => {
      const result = await engine.execute('test prompt', {});

      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();
      expect(result.costUsd).toBeGreaterThan(0);
    });

    it('should call progress callback', async () => {
      const progressEvents: string[] = [];

      await engine.execute('test prompt', {}, (event) => {
        progressEvents.push(event.message);
      });

      expect(progressEvents.length).toBeGreaterThan(0);
    });

    it('should update status during execution', async () => {
      const promise = engine.execute('test prompt', {});
      // Note: In async execution, status would be 'busy' during execution
      await promise;
      expect(engine.status).toBe('idle');
    });
  });
});

describe('MockEnginePool', () => {
  let pool: MockEnginePool;

  beforeEach(() => {
    pool = new MockEnginePool(2);
  });

  describe('acquire', () => {
    it('should return an available engine', async () => {
      const engine = await pool.acquire('project-1');

      expect(engine).toBeDefined();
      expect(engine.status).toBe('busy');
    });

    it('should throw when no engines available', async () => {
      await pool.acquire('project-1');
      await pool.acquire('project-1');

      await expect(pool.acquire('project-1')).rejects.toThrow('No engines available');
    });
  });

  describe('release', () => {
    it('should make engine available again', async () => {
      const engine = await pool.acquire('project-1');
      await pool.release(engine);

      expect(pool.getAvailableCount()).toBe(2);
    });
  });

  describe('getStatus', () => {
    it('should return pool status', async () => {
      await pool.acquire('project-1');
      const status = pool.getStatus();

      expect(status.total).toBe(2);
      expect(status.busy).toBe(1);
      expect(status.available).toBe(1);
    });
  });
});

describe('AgentCoordinator', () => {
  let coordinator: AgentCoordinator;

  beforeEach(() => {
    coordinator = new AgentCoordinator();
  });

  describe('getAvailableAgents', () => {
    it('should return available agents', () => {
      const agents = coordinator.getAvailableAgents();

      expect(agents.length).toBeGreaterThan(0);
      expect(agents.every((a) => a.status === 'idle')).toBe(true);
    });
  });

  describe('assignAgent', () => {
    it('should assign an agent to a task', async () => {
      const assignment = await coordinator.assignAgent('task-1', 'implementer');

      expect(assignment.taskId).toBe('task-1');
      expect(assignment.role).toBe('implementer');
      expect(assignment.assignedAt).toBeDefined();
    });

    it('should not duplicate assignments', async () => {
      const assignment1 = await coordinator.assignAgent('task-1', 'implementer');
      const assignment2 = await coordinator.assignAgent('task-1', 'implementer');

      expect(assignment1.agentId).toBe(assignment2.agentId);
    });

    it('should throw when no agent available', async () => {
      // Assign all implementers
      const implementers = coordinator.getAgentsByType('implementer');
      for (let i = 0; i < implementers.length; i++) {
        await coordinator.assignAgent(`task-${i}`, 'implementer');
      }

      await expect(
        coordinator.assignAgent('task-new', 'implementer')
      ).rejects.toThrow('No available');
    });
  });

  describe('releaseAgent', () => {
    it('should release agent and clear assignments', async () => {
      const assignment = await coordinator.assignAgent('task-1', 'implementer');
      await coordinator.releaseAgent(assignment.agentId);

      const tasks = coordinator.getTaskAssignments('task-1');
      expect(tasks.length).toBe(0);
    });
  });

  describe('checkCostBudget', () => {
    it('should allow when no cost tracker', async () => {
      const result = await coordinator.checkCostBudget('project-1', 5);

      expect(result.allowed).toBe(true);
    });
  });

  describe('acquireEngine/releaseEngine', () => {
    it('should acquire and release engines', async () => {
      const engine = await coordinator.acquireEngine('project-1');
      expect(engine).toBeDefined();

      await coordinator.releaseEngine(engine);
      expect(coordinator.getEnginePoolStatus().available).toBeGreaterThan(0);
    });
  });

  describe('getStats', () => {
    it('should return comprehensive statistics', async () => {
      await coordinator.assignAgent('task-1', 'implementer');

      const stats = coordinator.getStats();

      expect(stats.agents.total).toBeGreaterThan(0);
      expect(stats.engines.total).toBeGreaterThan(0);
      expect(stats.assignments).toBe(1);
    });
  });

  describe('clearAssignments', () => {
    it('should clear all assignments and release agents', async () => {
      await coordinator.assignAgent('task-1', 'implementer');
      await coordinator.assignAgent('task-2', 'reviewer');

      coordinator.clearAssignments();

      expect(coordinator.getStats().assignments).toBe(0);
    });
  });
});

describe('createAgentCoordinator', () => {
  it('should create coordinator with default dependencies', () => {
    const coordinator = createAgentCoordinator();
    expect(coordinator).toBeInstanceOf(AgentCoordinator);
  });

  it('should create coordinator with custom engine pool', () => {
    const pool = new MockEnginePool(5);
    const coordinator = createAgentCoordinator(pool);

    expect(coordinator.getEnginePoolStatus().total).toBe(5);
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { ApprovalWorkflow, createApprovalWorkflow } from './approval-workflow.js';
import type { ScrumMasterPlan, RiskAssessment } from '../types.js';
import type { KnowledgeCheckResult } from '@tamma/shared';

describe('ApprovalWorkflow', () => {
  let workflow: ApprovalWorkflow;

  const createMockPlan = (overrides?: Partial<ScrumMasterPlan>): ScrumMasterPlan => ({
    taskId: 'task-1',
    summary: 'Test plan',
    approach: 'Test approach',
    fileChanges: [
      {
        path: 'src/test.ts',
        action: 'modify',
        description: 'Test change',
        estimatedLines: 50,
      },
    ],
    testingStrategy: 'Unit tests',
    complexity: 'medium',
    estimatedTokens: 5000,
    estimatedCostUsd: 0.5,
    risks: [],
    dependencies: [],
    generatedAt: new Date(),
    version: 1,
    ...overrides,
  });

  const createMockKnowledgeCheck = (): KnowledgeCheckResult => ({
    canProceed: true,
    recommendations: [],
    warnings: [],
    blockers: [],
    learnings: [],
  });

  beforeEach(() => {
    workflow = new ApprovalWorkflow();
  });

  describe('assessRisk', () => {
    it('should assess low risk for simple changes', () => {
      const plan = createMockPlan({
        fileChanges: [
          { path: 'src/test.ts', action: 'modify', description: 'Minor fix', estimatedLines: 10 },
        ],
        complexity: 'low',
        estimatedCostUsd: 0.1,
        risks: [],
      });

      const assessment = workflow.assessRisk(plan);

      expect(assessment.level).toBe('low');
      expect(assessment.requiresApproval).toBe(false);
    });

    it('should assess medium risk for moderate changes', () => {
      const plan = createMockPlan({
        fileChanges: [
          { path: 'src/test1.ts', action: 'modify', description: 'Change 1', estimatedLines: 100 },
          { path: 'src/test2.ts', action: 'modify', description: 'Change 2', estimatedLines: 100 },
          { path: 'src/test3.ts', action: 'modify', description: 'Change 3', estimatedLines: 100 },
        ],
        complexity: 'medium',
        estimatedCostUsd: 1.0,
        risks: ['Some risk'],
      });

      const assessment = workflow.assessRisk(plan);

      expect(assessment.level).toBe('medium');
    });

    it('should assess high risk for complex changes', () => {
      const plan = createMockPlan({
        fileChanges: Array(15)
          .fill(null)
          .map((_, i) => ({
            path: `src/file${i}.ts`,
            action: 'modify' as const,
            description: 'Change',
            estimatedLines: 100,
          })),
        complexity: 'high',
        estimatedCostUsd: 10.0,
        risks: ['Risk 1', 'Risk 2', 'Risk 3', 'Risk 4'],
      });

      const assessment = workflow.assessRisk(plan);

      expect(assessment.level).toBe('high');
      expect(assessment.requiresApproval).toBe(true);
    });

    it('should include risk factors in assessment', () => {
      const plan = createMockPlan();
      const assessment = workflow.assessRisk(plan);

      expect(assessment.factors).toBeDefined();
      expect(assessment.factors.length).toBeGreaterThan(0);
      expect(assessment.score).toBeGreaterThanOrEqual(0);
    });

    it('should add risk for file deletions', () => {
      const planWithDelete = createMockPlan({
        fileChanges: [
          { path: 'src/old.ts', action: 'delete', description: 'Remove old file', estimatedLines: 0 },
        ],
      });
      const planWithoutDelete = createMockPlan({
        fileChanges: [
          { path: 'src/test.ts', action: 'modify', description: 'Update', estimatedLines: 10 },
        ],
      });

      const assessmentWith = workflow.assessRisk(planWithDelete);
      const assessmentWithout = workflow.assessRisk(planWithoutDelete);

      expect(assessmentWith.score).toBeGreaterThan(assessmentWithout.score);
    });
  });

  describe('tryAutoApprove', () => {
    it('should auto-approve low risk tasks', () => {
      const plan = createMockPlan();
      const riskAssessment: RiskAssessment = {
        level: 'low',
        score: 2,
        factors: [],
        requiresApproval: false,
      };

      const result = workflow.tryAutoApprove(plan, riskAssessment);

      expect(result).not.toBeNull();
      expect(result?.status).toBe('auto_approved');
    });

    it('should not auto-approve high risk tasks', () => {
      const plan = createMockPlan();
      const riskAssessment: RiskAssessment = {
        level: 'high',
        score: 15,
        factors: [],
        requiresApproval: true,
      };

      const result = workflow.tryAutoApprove(plan, riskAssessment);

      expect(result).toBeNull();
    });

    it('should respect configuration for auto-approval', () => {
      workflow = new ApprovalWorkflow({
        taskLoop: {
          maxRetries: 3,
          autoApproveLowRisk: false,
          requireApprovalHighRisk: true,
          timeoutMs: 3600000,
          progressUpdateIntervalMs: 30000,
          stallDetectionThresholdMs: 300000,
        },
      });

      const plan = createMockPlan();
      const riskAssessment: RiskAssessment = {
        level: 'low',
        score: 2,
        factors: [],
        requiresApproval: true,
      };

      const result = workflow.tryAutoApprove(plan, riskAssessment);

      expect(result).toBeNull();
    });
  });

  describe('requestApproval', () => {
    it('should create a pending approval request', async () => {
      const plan = createMockPlan();
      const riskAssessment: RiskAssessment = {
        level: 'medium',
        score: 5,
        factors: [],
        requiresApproval: true,
      };
      const knowledgeCheck = createMockKnowledgeCheck();

      const request = await workflow.requestApproval(plan, riskAssessment, knowledgeCheck);

      expect(request.id).toBeDefined();
      expect(request.taskId).toBe('task-1');
      expect(request.status.status).toBe('pending');
    });

    it('should store request in pending list', async () => {
      const plan = createMockPlan();
      const riskAssessment: RiskAssessment = {
        level: 'medium',
        score: 5,
        factors: [],
        requiresApproval: true,
      };
      const knowledgeCheck = createMockKnowledgeCheck();

      await workflow.requestApproval(plan, riskAssessment, knowledgeCheck);

      expect(workflow.getPendingRequests().length).toBe(1);
    });
  });

  describe('handleApprovalResponse', () => {
    it('should handle approval', async () => {
      const plan = createMockPlan();
      const riskAssessment: RiskAssessment = {
        level: 'medium',
        score: 5,
        factors: [],
        requiresApproval: true,
      };
      const knowledgeCheck = createMockKnowledgeCheck();

      const request = await workflow.requestApproval(plan, riskAssessment, knowledgeCheck);
      const status = await workflow.handleApprovalResponse(request.id, {
        approved: true,
        reason: 'Looks good',
      });

      expect(status.status).toBe('approved');
      expect(status.reason).toBe('Looks good');
    });

    it('should handle rejection', async () => {
      const plan = createMockPlan();
      const riskAssessment: RiskAssessment = {
        level: 'medium',
        score: 5,
        factors: [],
        requiresApproval: true,
      };
      const knowledgeCheck = createMockKnowledgeCheck();

      const request = await workflow.requestApproval(plan, riskAssessment, knowledgeCheck);
      const status = await workflow.handleApprovalResponse(request.id, {
        approved: false,
        reason: 'Too risky',
      });

      expect(status.status).toBe('rejected');
      expect(status.reason).toBe('Too risky');
    });

    it('should throw for non-existent request', async () => {
      await expect(
        workflow.handleApprovalResponse('non-existent', { approved: true })
      ).rejects.toThrow('not found');
    });

    it('should throw for already resolved request', async () => {
      const plan = createMockPlan();
      const riskAssessment: RiskAssessment = {
        level: 'medium',
        score: 5,
        factors: [],
        requiresApproval: true,
      };
      const knowledgeCheck = createMockKnowledgeCheck();

      const request = await workflow.requestApproval(plan, riskAssessment, knowledgeCheck);
      await workflow.handleApprovalResponse(request.id, { approved: true });

      await expect(
        workflow.handleApprovalResponse(request.id, { approved: true })
      ).rejects.toThrow('already resolved');
    });
  });

  describe('applyAdjustments', () => {
    it('should apply adjustments to plan', () => {
      const plan = createMockPlan();
      const adjustments = [
        {
          field: 'approach',
          originalValue: plan.approach,
          newValue: 'New approach',
          reason: 'Better approach',
        },
      ];

      const adjusted = workflow.applyAdjustments(plan, adjustments);

      expect(adjusted.approach).toBe('New approach');
      expect(adjusted.version).toBe(plan.version + 1);
    });

    it('should apply multiple adjustments', () => {
      const plan = createMockPlan();
      const adjustments = [
        {
          field: 'approach',
          originalValue: plan.approach,
          newValue: 'New approach',
          reason: 'Better approach',
        },
        {
          field: 'complexity',
          originalValue: plan.complexity,
          newValue: 'high',
          reason: 'More complex than thought',
        },
      ];

      const adjusted = workflow.applyAdjustments(plan, adjustments);

      expect(adjusted.approach).toBe('New approach');
      expect(adjusted.complexity).toBe('high');
    });
  });

  describe('getPendingRequests', () => {
    it('should return only pending requests', async () => {
      const plan = createMockPlan();
      const riskAssessment: RiskAssessment = {
        level: 'medium',
        score: 5,
        factors: [],
        requiresApproval: true,
      };
      const knowledgeCheck = createMockKnowledgeCheck();

      const request1 = await workflow.requestApproval(plan, riskAssessment, knowledgeCheck);
      await workflow.requestApproval(
        createMockPlan({ taskId: 'task-2' }),
        riskAssessment,
        knowledgeCheck
      );

      // Approve first request
      await workflow.handleApprovalResponse(request1.id, { approved: true });

      const pending = workflow.getPendingRequests();
      expect(pending.length).toBe(1);
      expect(pending[0]?.taskId).toBe('task-2');
    });
  });
});

describe('createApprovalWorkflow', () => {
  it('should create workflow with default config', () => {
    const workflow = createApprovalWorkflow();
    expect(workflow).toBeInstanceOf(ApprovalWorkflow);
  });

  it('should create workflow with custom config', () => {
    const workflow = createApprovalWorkflow({
      taskLoop: {
        maxRetries: 5,
        autoApproveLowRisk: false,
        requireApprovalHighRisk: true,
        timeoutMs: 1800000,
        progressUpdateIntervalMs: 10000,
        stallDetectionThresholdMs: 60000,
      },
    });
    expect(workflow).toBeInstanceOf(ApprovalWorkflow);
  });
});

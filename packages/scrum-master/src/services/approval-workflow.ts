/**
 * Approval Workflow Service
 *
 * Handles plan approval gate, code review approval,
 * permission request handling, and human escalation.
 *
 * @module @tamma/scrum-master/services/approval-workflow
 */

import { nanoid } from 'nanoid';
import type { IPermissionService, AgentType } from '@tamma/gates';
import type { KnowledgeCheckResult } from '@tamma/shared';
import type {
  ScrumMasterPlan,
  RiskAssessment,
  RiskLevel,
  ApprovalRequest,
  ApprovalStatus,
  ApprovalResponse,
  IApprovalWorkflow,
  IUserInterface,
  PlanAdjustment,
} from '../types.js';
import type { ScrumMasterConfig } from '../config.js';
import { DEFAULT_SCRUM_MASTER_CONFIG, getRiskLevelFromConfig } from '../config.js';

/**
 * Set of field names that are unsafe for dynamic property assignment
 * to prevent prototype pollution attacks.
 */
const UNSAFE_FIELDS = new Set(['__proto__', 'constructor', 'prototype', 'toString', 'valueOf']);

export class ApprovalWorkflow implements IApprovalWorkflow {
  private pendingRequests: Map<string, ApprovalRequest> = new Map();
  private config: ScrumMasterConfig;
  private userInterface: IUserInterface | null = null;
  private permissionService: IPermissionService | null = null;

  constructor(config?: Partial<ScrumMasterConfig>) {
    this.config = { ...DEFAULT_SCRUM_MASTER_CONFIG, ...config };
  }

  /**
   * Set the user interface for approval requests
   */
  setUserInterface(ui: IUserInterface): void {
    this.userInterface = ui;
  }

  /**
   * Set the permission service for permission checks
   */
  setPermissionService(service: IPermissionService): void {
    this.permissionService = service;
  }

  /**
   * Assess risk level for a plan
   */
  assessRisk(plan: ScrumMasterPlan): RiskAssessment {
    const factors: Array<{ name: string; score: number; description: string }> = [];
    let totalScore = 0;

    // Factor 1: Number of files
    const fileCount = plan.fileChanges.length;
    const fileScore = fileCount > 10 ? 3 : fileCount > 5 ? 2 : fileCount > 2 ? 1 : 0;
    factors.push({
      name: 'file_count',
      score: fileScore,
      description: `${fileCount} files affected`,
    });
    totalScore += fileScore;

    // Factor 2: Complexity
    const complexityScores: Record<string, number> = { low: 0, medium: 2, high: 4 };
    const complexityScore = complexityScores[plan.complexity] ?? 2;
    factors.push({
      name: 'complexity',
      score: complexityScore,
      description: `${plan.complexity} complexity`,
    });
    totalScore += complexityScore;

    // Factor 3: Estimated cost
    const costScore =
      plan.estimatedCostUsd > 5 ? 3 : plan.estimatedCostUsd > 2 ? 2 : plan.estimatedCostUsd > 0.5 ? 1 : 0;
    factors.push({
      name: 'estimated_cost',
      score: costScore,
      description: `$${plan.estimatedCostUsd.toFixed(2)} estimated`,
    });
    totalScore += costScore;

    // Factor 4: Lines changed
    const totalLines = plan.fileChanges.reduce((sum, f) => sum + f.estimatedLines, 0);
    const linesScore = totalLines > 500 ? 3 : totalLines > 200 ? 2 : totalLines > 50 ? 1 : 0;
    factors.push({
      name: 'lines_changed',
      score: linesScore,
      description: `${totalLines} lines estimated`,
    });
    totalScore += linesScore;

    // Factor 5: Risks identified
    const riskScore = plan.risks.length > 3 ? 3 : plan.risks.length > 1 ? 2 : plan.risks.length > 0 ? 1 : 0;
    factors.push({
      name: 'identified_risks',
      score: riskScore,
      description: `${plan.risks.length} risks identified`,
    });
    totalScore += riskScore;

    // Factor 6: Creates new files
    const createsFiles = plan.fileChanges.some((f) => f.action === 'create');
    if (createsFiles) {
      factors.push({
        name: 'creates_files',
        score: 1,
        description: 'Creates new files',
      });
      totalScore += 1;
    }

    // Factor 7: Deletes files
    const deletesFiles = plan.fileChanges.some((f) => f.action === 'delete');
    if (deletesFiles) {
      factors.push({
        name: 'deletes_files',
        score: 2,
        description: 'Deletes files',
      });
      totalScore += 2;
    }

    // Determine risk level
    let level: RiskLevel;
    if (totalScore <= 4) {
      level = 'low';
    } else if (totalScore <= 10) {
      level = 'medium';
    } else {
      level = 'high';
    }

    // Determine if approval is required
    const requiresApproval =
      (level === 'high' && this.config.taskLoop.requireApprovalHighRisk) ||
      (level === 'medium' && !this.config.taskLoop.autoApproveLowRisk) ||
      (level === 'low' && !this.config.taskLoop.autoApproveLowRisk);

    return {
      level,
      score: totalScore,
      factors,
      requiresApproval,
    };
  }

  /**
   * Try to auto-approve if eligible
   */
  tryAutoApprove(
    plan: ScrumMasterPlan,
    riskAssessment: RiskAssessment
  ): ApprovalStatus | null {
    // Cannot auto-approve high risk
    if (riskAssessment.level === 'high') {
      return null;
    }

    // Check if auto-approve is enabled for low risk
    if (riskAssessment.level === 'low' && this.config.taskLoop.autoApproveLowRisk) {
      return {
        status: 'auto_approved',
        approvedAt: new Date(),
        reason: 'Low risk task auto-approved',
      };
    }

    // Medium risk - only auto-approve if explicitly configured
    if (riskAssessment.level === 'medium' && this.config.taskLoop.autoApproveLowRisk) {
      // Additional checks for medium risk auto-approval
      const maxFactorScore = Math.max(...riskAssessment.factors.map((f) => f.score));
      if (maxFactorScore <= 2) {
        return {
          status: 'auto_approved',
          approvedAt: new Date(),
          reason: 'Medium risk task auto-approved (no high-scoring factors)',
        };
      }
    }

    return null;
  }

  /**
   * Request approval for a plan
   */
  async requestApproval(
    plan: ScrumMasterPlan,
    riskAssessment: RiskAssessment,
    knowledgeCheck: KnowledgeCheckResult
  ): Promise<ApprovalRequest> {
    const requestId = nanoid();

    const request: ApprovalRequest = {
      id: requestId,
      taskId: plan.taskId,
      plan,
      riskLevel: riskAssessment.level,
      knowledgeCheck,
      requestedAt: new Date(),
      status: {
        status: 'pending',
      },
    };

    this.pendingRequests.set(requestId, request);

    // If we have a user interface, request approval interactively
    if (this.userInterface) {
      const response = await this.userInterface.requestApproval(
        plan,
        riskAssessment.level,
        knowledgeCheck
      );
      await this.handleApprovalResponse(requestId, response);
    }

    return this.pendingRequests.get(requestId)!;
  }

  /**
   * Handle human approval response
   */
  async handleApprovalResponse(
    requestId: string,
    response: ApprovalResponse
  ): Promise<ApprovalStatus> {
    const request = this.pendingRequests.get(requestId);
    if (!request) {
      throw new Error(`Approval request not found: ${requestId}`);
    }

    if (request.status.status !== 'pending') {
      throw new Error(`Approval request already resolved: ${request.status.status}`);
    }

    const newStatus: ApprovalStatus = {
      status: response.approved ? 'approved' : 'rejected',
      approvedAt: new Date(),
      approvedBy: 'user',
      reason: response.reason,
      adjustments: response.adjustments,
    };

    request.status = newStatus;

    return newStatus;
  }

  /**
   * Get pending approval requests
   */
  getPendingRequests(): ApprovalRequest[] {
    return Array.from(this.pendingRequests.values()).filter(
      (r) => r.status.status === 'pending'
    );
  }

  /**
   * Get all approval requests
   */
  getAllRequests(): ApprovalRequest[] {
    return Array.from(this.pendingRequests.values());
  }

  /**
   * Get approval request by ID
   */
  getRequest(requestId: string): ApprovalRequest | undefined {
    return this.pendingRequests.get(requestId);
  }

  /**
   * Apply adjustments to a plan
   */
  applyAdjustments(
    plan: ScrumMasterPlan,
    adjustments: PlanAdjustment[]
  ): ScrumMasterPlan {
    const adjusted = { ...plan };

    for (const adjustment of adjustments) {
      switch (adjustment.field) {
        case 'approach':
          adjusted.approach = adjustment.newValue as string;
          break;
        case 'testingStrategy':
          adjusted.testingStrategy = adjustment.newValue as string;
          break;
        case 'complexity':
          adjusted.complexity = adjustment.newValue as 'low' | 'medium' | 'high';
          break;
        case 'fileChanges':
          // Handle file change adjustments
          if (Array.isArray(adjustment.newValue)) {
            adjusted.fileChanges = adjustment.newValue as typeof plan.fileChanges;
          }
          break;
        case 'risks':
          if (Array.isArray(adjustment.newValue)) {
            adjusted.risks = adjustment.newValue as string[];
          }
          break;
        default:
          // Block unsafe field names to prevent prototype pollution
          if (UNSAFE_FIELDS.has(adjustment.field)) {
            throw new Error(`Unsafe field name: ${adjustment.field}`);
          }
          // For unknown fields, try to set directly
          (adjusted as Record<string, unknown>)[adjustment.field] = adjustment.newValue;
      }
    }

    adjusted.version = plan.version + 1;
    return adjusted;
  }

  /**
   * Check permission requirements for a plan
   */
  checkPermissionRequirements(
    plan: ScrumMasterPlan,
    agentType: AgentType,
    projectId: string
  ): { allowed: boolean; deniedActions: string[] } {
    if (!this.permissionService) {
      return { allowed: true, deniedActions: [] };
    }

    const deniedActions: string[] = [];

    // Check file permissions
    for (const fileChange of plan.fileChanges) {
      const action = fileChange.action === 'delete' ? 'write' : fileChange.action === 'create' ? 'write' : 'write';
      const result = this.permissionService.checkFilePermission(
        agentType,
        projectId,
        fileChange.path,
        action
      );
      if (!result.allowed) {
        deniedActions.push(`${action} ${fileChange.path}: ${result.reason ?? 'denied'}`);
      }
    }

    return {
      allowed: deniedActions.length === 0,
      deniedActions,
    };
  }

  /**
   * Clear all pending requests (for testing)
   */
  clearRequests(): void {
    this.pendingRequests.clear();
  }
}

/**
 * Create an approval workflow with optional config
 */
export function createApprovalWorkflow(
  config?: Partial<ScrumMasterConfig>
): ApprovalWorkflow {
  return new ApprovalWorkflow(config);
}

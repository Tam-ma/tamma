/**
 * Learning Capture Service
 *
 * Auto-captures learnings from task outcomes,
 * integrates with Knowledge Base, and detects success/failure patterns.
 *
 * @module @tamma/scrum-master/services/learning-capture
 */

import { nanoid } from 'nanoid';
import type { IKnowledgeService } from '@tamma/intelligence';
import type { LearningCapture as KBLearningCapture } from '@tamma/shared';
import type {
  TaskLoopContext,
  LearningCapture,
  ILearningCapture,
  ScrumMasterState,
} from '../types.js';
import type { LearningCaptureConfig } from '../config.js';
import { DEFAULT_SCRUM_MASTER_CONFIG } from '../config.js';

export class LearningCaptureService implements ILearningCapture {
  private knowledgeService: IKnowledgeService | null = null;
  private config: LearningCaptureConfig;
  private capturedLearnings: LearningCapture[] = [];

  constructor(config?: Partial<LearningCaptureConfig>) {
    this.config = { ...DEFAULT_SCRUM_MASTER_CONFIG.learningCapture, ...config };
  }

  /**
   * Set the knowledge service for integration
   */
  setKnowledgeService(service: IKnowledgeService): void {
    this.knowledgeService = service;
  }

  /**
   * Extract learnings from task outcome
   */
  async extractLearnings(context: TaskLoopContext): Promise<LearningCapture[]> {
    const learnings: LearningCapture[] = [];

    // Determine if we should capture based on outcome
    const isSuccess = context.implementation?.success && context.review?.passed;
    const isFailure = !isSuccess;

    if (isSuccess && !this.config.captureSuccess) {
      return learnings;
    }

    if (isFailure && !this.config.captureFailure) {
      return learnings;
    }

    // Extract learnings based on outcome
    if (isSuccess) {
      const successLearnings = await this.extractSuccessLearnings(context);
      learnings.push(...successLearnings);
    } else {
      const failureLearnings = await this.extractFailureLearnings(context);
      learnings.push(...failureLearnings);
    }

    // Extract learnings from retries
    if (context.retryCount > 0) {
      const retryLearnings = this.extractRetryLearnings(context);
      learnings.push(...retryLearnings);
    }

    // Extract learnings from blockers
    if (context.blockers.length > 0) {
      const blockerLearnings = this.extractBlockerLearnings(context);
      learnings.push(...blockerLearnings);
    }

    // Store captured learnings
    this.capturedLearnings.push(...learnings);

    return learnings;
  }

  /**
   * Extract learnings from successful tasks
   */
  private async extractSuccessLearnings(
    context: TaskLoopContext
  ): Promise<LearningCapture[]> {
    const learnings: LearningCapture[] = [];

    if (!context.plan || !context.implementation || !context.review) {
      return learnings;
    }

    // Learning: Successful approach
    learnings.push({
      taskId: context.task.id,
      type: 'success',
      title: `Successful approach for ${context.task.type} task`,
      description: `The approach "${context.plan.approach}" successfully completed a ${context.task.type} task with ${context.plan.fileChanges.length} file changes.`,
      keywords: this.extractKeywords(context),
      priority: 'medium',
      suggestedKnowledgeType: 'recommendation',
      status: this.config.requireApproval ? 'pending' : 'approved',
    });

    // Learning: Effective testing strategy
    if (context.implementation.testsRun > 0 && context.implementation.testsPassed === context.implementation.testsRun) {
      learnings.push({
        taskId: context.task.id,
        type: 'success',
        title: `Effective testing strategy: ${context.plan.testingStrategy}`,
        description: `Testing strategy resulted in ${context.implementation.testsRun} passing tests for ${context.task.type} task.`,
        keywords: ['testing', 'quality', context.task.type, ...context.task.labels],
        priority: 'low',
        suggestedKnowledgeType: 'learning',
        status: this.config.requireApproval ? 'pending' : 'approved',
      });
    }

    // Learning: Efficient implementation (low cost, fast)
    if (context.implementation.costUsd < 0.5 && context.implementation.durationMs < 60000) {
      learnings.push({
        taskId: context.task.id,
        type: 'success',
        title: 'Efficient implementation pattern',
        description: `Task completed in ${Math.round(context.implementation.durationMs / 1000)}s with cost $${context.implementation.costUsd.toFixed(4)}`,
        keywords: ['efficiency', 'cost-effective', 'fast', context.task.type],
        priority: 'low',
        suggestedKnowledgeType: 'learning',
        status: this.config.requireApproval ? 'pending' : 'approved',
      });
    }

    return learnings;
  }

  /**
   * Extract learnings from failed tasks
   */
  private async extractFailureLearnings(
    context: TaskLoopContext
  ): Promise<LearningCapture[]> {
    const learnings: LearningCapture[] = [];

    // Learning from implementation failure
    if (context.implementation && !context.implementation.success) {
      learnings.push({
        taskId: context.task.id,
        type: 'failure',
        title: `Implementation failure for ${context.task.type} task`,
        description: `Implementation failed: ${context.implementation.error ?? 'Unknown error'}`,
        keywords: ['failure', 'implementation', context.task.type, ...context.task.labels],
        priority: 'high',
        suggestedKnowledgeType: 'learning',
        status: this.config.requireApproval ? 'pending' : 'approved',
      });
    }

    // Learning from review failure
    if (context.review && !context.review.passed) {
      const issues = context.review.issues
        .filter((i) => i.severity === 'error')
        .map((i) => i.message);

      learnings.push({
        taskId: context.task.id,
        type: 'failure',
        title: `Review failure: ${context.review.issues.length} issues found`,
        description: `Review failed with score ${context.review.score}. Key issues: ${issues.slice(0, 3).join('; ')}`,
        keywords: ['failure', 'review', 'quality', context.task.type],
        priority: 'high',
        suggestedKnowledgeType: 'learning',
        status: this.config.requireApproval ? 'pending' : 'approved',
      });

      // Create prohibition for repeated patterns
      const errorCategories = [...new Set(context.review.issues.map((i) => i.category))];
      for (const category of errorCategories) {
        const categoryIssues = context.review.issues.filter((i) => i.category === category);
        if (categoryIssues.length >= 2) {
          learnings.push({
            taskId: context.task.id,
            type: 'failure',
            title: `Avoid ${category} issues in ${context.task.type} tasks`,
            description: `Multiple ${category} issues detected: ${categoryIssues.map((i) => i.message).join('; ')}`,
            keywords: ['prohibition', category, context.task.type],
            priority: 'medium',
            suggestedKnowledgeType: 'prohibition',
            status: this.config.requireApproval ? 'pending' : 'approved',
          });
        }
      }
    }

    return learnings;
  }

  /**
   * Extract learnings from retry attempts
   */
  private extractRetryLearnings(context: TaskLoopContext): LearningCapture[] {
    const learnings: LearningCapture[] = [];

    if (context.retryCount > 0) {
      learnings.push({
        taskId: context.task.id,
        type: 'improvement',
        title: `Task required ${context.retryCount} retries`,
        description: `${context.task.type} task needed ${context.retryCount} retry attempts. Consider improving initial approach.`,
        keywords: ['retry', 'improvement', context.task.type],
        priority: 'medium',
        suggestedKnowledgeType: 'learning',
        status: this.config.requireApproval ? 'pending' : 'approved',
      });
    }

    return learnings;
  }

  /**
   * Extract learnings from blockers
   */
  private extractBlockerLearnings(context: TaskLoopContext): LearningCapture[] {
    const learnings: LearningCapture[] = [];

    const resolvedBlockers = context.blockers.filter((b) => b.resolved);
    const unresolvedBlockers = context.blockers.filter((b) => !b.resolved);

    // Learnings from resolved blockers
    for (const blocker of resolvedBlockers) {
      learnings.push({
        taskId: context.task.id,
        type: 'improvement',
        title: `Blocker resolved: ${blocker.type}`,
        description: `Blocker "${blocker.message}" was resolved with: ${blocker.resolution ?? 'unknown resolution'}`,
        keywords: ['blocker', 'resolution', blocker.type, context.task.type],
        priority: 'low',
        suggestedKnowledgeType: 'learning',
        status: this.config.requireApproval ? 'pending' : 'approved',
      });
    }

    // Prohibitions from unresolved blockers
    for (const blocker of unresolvedBlockers) {
      learnings.push({
        taskId: context.task.id,
        type: 'failure',
        title: `Avoid pattern causing: ${blocker.type}`,
        description: `Unresolved blocker: ${blocker.message}`,
        keywords: ['prohibition', 'blocker', blocker.type, context.task.type],
        priority: 'high',
        suggestedKnowledgeType: 'prohibition',
        status: this.config.requireApproval ? 'pending' : 'approved',
      });
    }

    return learnings;
  }

  /**
   * Extract keywords from context
   */
  private extractKeywords(context: TaskLoopContext): string[] {
    const keywords: string[] = [context.task.type, ...context.task.labels];

    if (context.plan) {
      // Extract technology keywords from file paths
      for (const file of context.plan.fileChanges) {
        const ext = file.path.split('.').pop();
        if (ext) {
          keywords.push(ext);
        }
        // Extract directory keywords
        const parts = file.path.split('/');
        if (parts.length > 1) {
          keywords.push(parts[0]!);
        }
      }

      // Add complexity
      keywords.push(`${context.plan.complexity}-complexity`);
    }

    // Deduplicate and return
    return [...new Set(keywords)];
  }

  /**
   * Submit learning to knowledge base
   */
  async submitLearning(learning: LearningCapture): Promise<void> {
    if (!this.knowledgeService) {
      // Store locally if no knowledge service
      this.capturedLearnings.push(learning);
      return;
    }

    // Convert to KnowledgeBase format
    const kbLearning: KBLearningCapture = {
      taskId: learning.taskId,
      projectId: '', // Will be set by knowledge service
      outcome: learning.type === 'success' ? 'success' : 'failure',
      whatWorked: learning.type === 'success' ? learning.description : undefined,
      whatFailed: learning.type === 'failure' ? learning.description : undefined,
      suggestedTitle: learning.title,
      suggestedDescription: learning.description,
      suggestedKeywords: learning.keywords,
      suggestedPriority: learning.priority,
    };

    await this.knowledgeService.captureLearning(kbLearning);
  }

  /**
   * Detect success patterns across multiple contexts
   */
  async detectSuccessPatterns(context: TaskLoopContext): Promise<string[]> {
    const patterns: string[] = [];

    if (!context.implementation?.success || !context.review?.passed) {
      return patterns;
    }

    // Pattern: Fast completion
    if (context.implementation.durationMs < 30000) {
      patterns.push('Fast completion (< 30s)');
    }

    // Pattern: Low cost
    if (context.implementation.costUsd < 0.1) {
      patterns.push('Low cost (< $0.10)');
    }

    // Pattern: All tests passing
    if (context.implementation.testsRun > 0 && context.implementation.testsPassed === context.implementation.testsRun) {
      patterns.push('100% test pass rate');
    }

    // Pattern: No retries needed
    if (context.retryCount === 0) {
      patterns.push('First-attempt success');
    }

    // Pattern: No blockers
    if (context.blockers.length === 0) {
      patterns.push('No blockers encountered');
    }

    // Pattern: High review score
    if (context.review.score >= 90) {
      patterns.push(`High review score (${context.review.score}%)`);
    }

    return patterns;
  }

  /**
   * Detect failure patterns across multiple contexts
   */
  async detectFailurePatterns(context: TaskLoopContext): Promise<string[]> {
    const patterns: string[] = [];

    // Pattern: Implementation failure
    if (context.implementation && !context.implementation.success) {
      patterns.push('Implementation failed');
      if (context.implementation.error) {
        patterns.push(`Error: ${context.implementation.error.slice(0, 50)}`);
      }
    }

    // Pattern: Review failure
    if (context.review && !context.review.passed) {
      patterns.push(`Review failed (score: ${context.review.score}%)`);

      // Categorize issues
      const categories = [...new Set(context.review.issues.map((i) => i.category))];
      for (const cat of categories) {
        const count = context.review.issues.filter((i) => i.category === cat).length;
        patterns.push(`${count} ${cat} issue(s)`);
      }
    }

    // Pattern: Multiple retries
    if (context.retryCount > 1) {
      patterns.push(`Required ${context.retryCount} retries`);
    }

    // Pattern: Blockers
    if (context.blockers.length > 0) {
      const blockerTypes = [...new Set(context.blockers.map((b) => b.type))];
      patterns.push(`Blockers: ${blockerTypes.join(', ')}`);
    }

    // Pattern: Cost overrun
    if (context.currentCostUsd > context.costBudgetUsd * 0.8) {
      patterns.push('Near/over cost budget');
    }

    // Pattern: Timeout approaching
    const elapsedMs = Date.now() - context.startTime.getTime();
    if (elapsedMs > 1800000) {
      // 30 minutes
      patterns.push('Long execution time');
    }

    return patterns;
  }

  /**
   * Get all captured learnings
   */
  getCapturedLearnings(): LearningCapture[] {
    return [...this.capturedLearnings];
  }

  /**
   * Get learnings for a specific task
   */
  getLearningsForTask(taskId: string): LearningCapture[] {
    return this.capturedLearnings.filter((l) => l.taskId === taskId);
  }

  /**
   * Clear captured learnings
   */
  clearCapturedLearnings(): void {
    this.capturedLearnings = [];
  }
}

/**
 * Create a learning capture service with optional config
 */
export function createLearningCapture(
  config?: Partial<LearningCaptureConfig>
): LearningCaptureService {
  return new LearningCaptureService(config);
}

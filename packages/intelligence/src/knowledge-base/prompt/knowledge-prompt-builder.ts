/**
 * Knowledge Prompt Builder
 *
 * Builds agent prompts augmented with knowledge base context.
 */

import type { KnowledgeCheckResult, KnowledgeMatch } from '@tamma/shared';
import type { TaskContext, DevelopmentPlan } from '../types.js';

/**
 * Options for prompt building
 */
export interface PromptBuilderOptions {
  /** Include blockers section */
  includeBlockers: boolean;
  /** Include warnings section */
  includeWarnings: boolean;
  /** Include recommendations section */
  includeRecommendations: boolean;
  /** Include learnings section */
  includeLearnings: boolean;
  /** Include examples from learnings */
  includeExamples: boolean;
  /** Maximum examples to include per learning */
  maxExamplesPerLearning: number;
  /** Use compact format to save tokens */
  compactFormat: boolean;
}

/**
 * Default prompt builder options
 */
const DEFAULT_OPTIONS: PromptBuilderOptions = {
  includeBlockers: true,
  includeWarnings: true,
  includeRecommendations: true,
  includeLearnings: true,
  includeExamples: true,
  maxExamplesPerLearning: 1,
  compactFormat: false,
};

/**
 * Knowledge prompt builder
 */
export class KnowledgePromptBuilder {
  private options: PromptBuilderOptions;

  constructor(options?: Partial<PromptBuilderOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Build a complete agent prompt with knowledge context
   */
  buildAgentPrompt(
    task: TaskContext,
    plan: DevelopmentPlan,
    knowledgeCheck: KnowledgeCheckResult
  ): string {
    const sections: string[] = [];

    // Task section
    sections.push(this.buildTaskSection(task));

    // Plan section
    sections.push(this.buildPlanSection(plan));

    // Knowledge context
    const knowledgeSection = this.buildKnowledgeSection(knowledgeCheck);
    if (knowledgeSection) {
      sections.push(knowledgeSection);
    }

    return sections.join('\n\n');
  }

  /**
   * Build only the knowledge context section
   */
  buildKnowledgeContext(knowledgeCheck: KnowledgeCheckResult): string {
    return this.buildKnowledgeSection(knowledgeCheck) ?? '';
  }

  /**
   * Build summary of knowledge check
   */
  buildKnowledgeSummary(knowledgeCheck: KnowledgeCheckResult): string {
    const parts: string[] = [];

    if (!knowledgeCheck.canProceed) {
      parts.push(
        `BLOCKED: ${knowledgeCheck.blockers.length} critical prohibition(s) matched`
      );
    }

    if (knowledgeCheck.warnings.length > 0) {
      parts.push(`${knowledgeCheck.warnings.length} warning(s)`);
    }

    if (knowledgeCheck.recommendations.length > 0) {
      parts.push(`${knowledgeCheck.recommendations.length} recommendation(s)`);
    }

    if (knowledgeCheck.learnings.length > 0) {
      parts.push(`${knowledgeCheck.learnings.length} relevant learning(s)`);
    }

    if (parts.length === 0) {
      return 'No relevant knowledge found';
    }

    return parts.join(', ');
  }

  // === Private Methods ===

  private buildTaskSection(task: TaskContext): string {
    if (this.options.compactFormat) {
      return `## Task\n${task.description}`;
    }

    return `## Task

**ID:** ${task.taskId}
**Type:** ${task.type}
**Project:** ${task.projectId}

${task.description}`;
  }

  private buildPlanSection(plan: DevelopmentPlan): string {
    if (this.options.compactFormat) {
      return `## Plan\n${plan.summary}\n\n**Approach:** ${plan.approach}`;
    }

    const filesSection =
      plan.fileChanges.length > 0
        ? `\n**Files:**\n${plan.fileChanges
            .map((f) => `- \`${f.path}\` (${f.action}): ${f.description}`)
            .join('\n')}`
        : '';

    return `## Plan

**Summary:** ${plan.summary}

**Approach:** ${plan.approach}
${filesSection}`;
  }

  private buildKnowledgeSection(
    knowledgeCheck: KnowledgeCheckResult
  ): string | null {
    const subsections: string[] = [];

    // Blockers (always included if present)
    if (this.options.includeBlockers && knowledgeCheck.blockers.length > 0) {
      subsections.push(this.buildBlockersSection(knowledgeCheck.blockers));
    }

    // Warnings
    if (this.options.includeWarnings && knowledgeCheck.warnings.length > 0) {
      subsections.push(this.buildWarningsSection(knowledgeCheck.warnings));
    }

    // Recommendations
    if (
      this.options.includeRecommendations &&
      knowledgeCheck.recommendations.length > 0
    ) {
      subsections.push(
        this.buildRecommendationsSection(knowledgeCheck.recommendations)
      );
    }

    // Learnings
    if (this.options.includeLearnings && knowledgeCheck.learnings.length > 0) {
      subsections.push(this.buildLearningsSection(knowledgeCheck.learnings));
    }

    if (subsections.length === 0) {
      return null;
    }

    return `## Knowledge Base Context\n\n${subsections.join('\n\n')}`;
  }

  private buildBlockersSection(blockers: KnowledgeMatch[]): string {
    const header = this.options.compactFormat
      ? '### CRITICAL BLOCKERS - DO NOT PROCEED'
      : '### CRITICAL BLOCKERS - DO NOT PROCEED\n\n**The following critical prohibitions have been matched. Task execution must be blocked until these are addressed:**';

    const items = blockers.map((blocker) => {
      const { knowledge, matchReason } = blocker;
      if (this.options.compactFormat) {
        return `- **${knowledge.title}**: ${knowledge.description}\n  Reason: ${matchReason}`;
      }
      return `#### ${knowledge.title}

**Priority:** ${knowledge.priority.toUpperCase()}

${knowledge.description}

${knowledge.details ? `**Details:** ${knowledge.details}\n` : ''}
**Match Reason:** ${matchReason}`;
    });

    return `${header}\n\n${items.join('\n\n')}`;
  }

  private buildWarningsSection(warnings: KnowledgeMatch[]): string {
    const header = this.options.compactFormat
      ? '### Warnings - Proceed with Caution'
      : '### Warnings - Proceed with Caution\n\n**The following prohibitions have been matched. Review and ensure compliance:**';

    const items = warnings.map((warning) => {
      const { knowledge, matchReason } = warning;
      if (this.options.compactFormat) {
        return `- **${knowledge.title}**: ${knowledge.description}`;
      }
      return `- **${knowledge.title}** (${knowledge.priority}): ${knowledge.description}
  - Match reason: ${matchReason}`;
    });

    return `${header}\n\n${items.join('\n')}`;
  }

  private buildRecommendationsSection(recommendations: KnowledgeMatch[]): string {
    const header = this.options.compactFormat
      ? '### Recommendations'
      : '### Recommendations\n\n**Consider the following best practices:**';

    const items = recommendations.map((rec) => {
      const { knowledge, applicability } = rec;
      const applicabilityStr = applicability
        ? ` (${Math.round(applicability * 100)}% applicable)`
        : '';

      if (this.options.compactFormat) {
        return `- **${knowledge.title}**${applicabilityStr}: ${knowledge.description}`;
      }

      let item = `- **${knowledge.title}**${applicabilityStr}
  ${knowledge.description}`;

      if (knowledge.details) {
        item += `\n  *Details:* ${knowledge.details}`;
      }

      return item;
    });

    return `${header}\n\n${items.join('\n\n')}`;
  }

  private buildLearningsSection(learnings: KnowledgeMatch[]): string {
    const header = this.options.compactFormat
      ? '### Relevant Learnings from Past Tasks'
      : '### Relevant Learnings from Past Tasks\n\n**Insights from similar previous tasks:**';

    const items = learnings.map((learning) => {
      const { knowledge } = learning;

      if (this.options.compactFormat) {
        let item = `- **${knowledge.title}**: ${knowledge.description}`;
        if (
          this.options.includeExamples &&
          knowledge.examples &&
          knowledge.examples.length > 0
        ) {
          const ex = knowledge.examples[0]!;
          if (ex.goodApproach) {
            item += `\n  Good approach: ${ex.goodApproach}`;
          }
        }
        return item;
      }

      let item = `- **${knowledge.title}**
  ${knowledge.description}`;

      if (knowledge.sourceRef) {
        item += `\n  *Source:* ${knowledge.sourceRef}`;
      }

      // Include examples
      if (
        this.options.includeExamples &&
        knowledge.examples &&
        knowledge.examples.length > 0
      ) {
        const examplesToInclude = knowledge.examples.slice(
          0,
          this.options.maxExamplesPerLearning
        );

        for (const example of examplesToInclude) {
          item += '\n\n  **Example:**';
          item += `\n  - Scenario: ${example.scenario}`;
          if (example.goodApproach) {
            item += `\n  - Good approach: ${example.goodApproach}`;
          }
          if (example.badApproach) {
            item += `\n  - Avoid: ${example.badApproach}`;
          }
          if (example.outcome) {
            item += `\n  - Outcome: ${example.outcome}`;
          }
        }
      }

      return item;
    });

    return `${header}\n\n${items.join('\n\n')}`;
  }

  /**
   * Update options
   */
  setOptions(options: Partial<PromptBuilderOptions>): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * Get current options
   */
  getOptions(): PromptBuilderOptions {
    return { ...this.options };
  }
}

/**
 * Pre-Task Knowledge Checker
 *
 * Validates tasks against the knowledge base before execution.
 */

import type {
  KnowledgeEntry,
  KnowledgeCheckResult,
  KnowledgeMatch,
  KnowledgeQuery,
  AgentType,
} from '@tamma/shared';
import type {
  IKnowledgeService,
  TaskContext,
  DevelopmentPlan,
  MatchContext,
  MatchResult,
  PreTaskCheckConfig,
} from '../types.js';
import { KeywordMatcher } from '../matchers/keyword-matcher.js';
import { PatternMatcher } from '../matchers/pattern-matcher.js';
import { combineMatchResults } from '../matchers/relevance-ranker.js';

/**
 * Options for pre-task checking
 */
export interface PreTaskCheckerOptions extends PreTaskCheckConfig {
  /** Additional patterns to check prohibitions against */
  additionalPatterns?: string[];
}

/**
 * Default checker options
 */
const DEFAULT_OPTIONS: PreTaskCheckerOptions = {
  enabled: true,
  blockOnCritical: true,
  maxRecommendations: 5,
  maxLearnings: 3,
  maxWarnings: 10,
};

/**
 * Pre-task knowledge checker
 */
export class PreTaskChecker {
  private knowledgeService: IKnowledgeService;
  private options: PreTaskCheckerOptions;
  private keywordMatcher: KeywordMatcher;
  private patternMatcher: PatternMatcher;

  constructor(
    knowledgeService: IKnowledgeService,
    options?: Partial<PreTaskCheckerOptions>
  ) {
    this.knowledgeService = knowledgeService;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.keywordMatcher = new KeywordMatcher();
    this.patternMatcher = new PatternMatcher();
  }

  /**
   * Check knowledge base before task execution
   */
  async checkBeforeTask(
    task: TaskContext,
    plan: DevelopmentPlan
  ): Promise<KnowledgeCheckResult> {
    if (!this.options.enabled) {
      return {
        canProceed: true,
        recommendations: [],
        warnings: [],
        blockers: [],
        learnings: [],
      };
    }

    // Build query from task and plan
    const query: KnowledgeQuery = {
      taskType: task.type,
      taskDescription: task.description,
      projectId: task.projectId,
      agentType: task.agentType as AgentType,
      filePaths: plan.fileChanges.map((f) => f.path),
      technologies: this.extractTechnologies(plan),
    };

    // Get relevant knowledge
    const knowledge = await this.knowledgeService.getRelevantKnowledge(query);

    // Build match context
    const matchContext: MatchContext = {
      taskDescription: task.description,
      filePaths: plan.fileChanges.map((f) => f.path),
      technologies: plan.technologies,
      planApproach: plan.approach,
    };

    // Initialize result
    const result: KnowledgeCheckResult = {
      canProceed: true,
      recommendations: [],
      warnings: [],
      blockers: [],
      learnings: [],
    };

    // Check prohibitions
    for (const prohibition of knowledge.prohibitions) {
      const match = await this.checkProhibitionMatch(prohibition, matchContext);
      if (match) {
        const knowledgeMatch: KnowledgeMatch = {
          knowledge: prohibition,
          matchReason: match.reason,
          matchScore: match.score,
        };

        if (prohibition.priority === 'critical' && this.options.blockOnCritical) {
          result.canProceed = false;
          result.blockers.push(knowledgeMatch);
        } else {
          result.warnings.push(knowledgeMatch);
        }
      }
    }

    // Limit warnings
    result.warnings = result.warnings
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, this.options.maxWarnings);

    // Process recommendations
    for (const rec of knowledge.recommendations) {
      const match = await this.assessApplicability(rec, matchContext);
      if (match) {
        result.recommendations.push({
          knowledge: rec,
          matchReason: match.reason,
          matchScore: match.score,
          applicability: match.score,
        });
      }
    }

    // Limit and sort recommendations
    result.recommendations = result.recommendations
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, this.options.maxRecommendations);

    // Process learnings
    for (const learning of knowledge.learnings) {
      const match = await this.assessRelevance(learning, matchContext);
      if (match) {
        result.learnings.push({
          knowledge: learning,
          matchReason: match.reason,
          matchScore: match.score,
        });
      }
    }

    // Limit learnings
    result.learnings = result.learnings
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, this.options.maxLearnings);

    return result;
  }

  /**
   * Check if a prohibition matches the task plan
   */
  private async checkProhibitionMatch(
    prohibition: KnowledgeEntry,
    context: MatchContext
  ): Promise<MatchResult | null> {
    const results: MatchResult[] = [];

    // Check patterns against file paths
    const patternMatch = await this.patternMatcher.match(prohibition, context);
    if (patternMatch) {
      results.push(patternMatch);
    }

    // Check keywords in context
    const keywordMatch = await this.keywordMatcher.match(prohibition, context);
    if (keywordMatch) {
      results.push(keywordMatch);
    }

    if (results.length === 0) {
      return null;
    }

    // Combine results with emphasis on pattern matches for prohibitions
    return combineMatchResults(results);
  }

  /**
   * Assess how applicable a recommendation is
   */
  private async assessApplicability(
    recommendation: KnowledgeEntry,
    context: MatchContext
  ): Promise<MatchResult | null> {
    const results: MatchResult[] = [];

    // Keyword matching
    const keywordMatch = await this.keywordMatcher.match(recommendation, context);
    if (keywordMatch) {
      results.push(keywordMatch);
    }

    // Pattern matching (if patterns defined)
    if (recommendation.patterns && recommendation.patterns.length > 0) {
      const patternMatch = await this.patternMatcher.match(recommendation, context);
      if (patternMatch) {
        results.push(patternMatch);
      }
    }

    if (results.length === 0) {
      return null;
    }

    return combineMatchResults(results);
  }

  /**
   * Assess relevance of a learning
   */
  private async assessRelevance(
    learning: KnowledgeEntry,
    context: MatchContext
  ): Promise<MatchResult | null> {
    // Similar to applicability assessment
    return this.assessApplicability(learning, context);
  }

  /**
   * Extract technologies from the development plan
   */
  private extractTechnologies(plan: DevelopmentPlan): string[] {
    const technologies: Set<string> = new Set();

    // Add explicit technologies
    if (plan.technologies) {
      for (const tech of plan.technologies) {
        technologies.add(tech.toLowerCase());
      }
    }

    // Extract from file extensions
    for (const file of plan.fileChanges) {
      const ext = file.path.split('.').pop()?.toLowerCase();
      if (ext) {
        const techMap: Record<string, string> = {
          ts: 'typescript',
          tsx: 'typescript',
          js: 'javascript',
          jsx: 'javascript',
          py: 'python',
          rs: 'rust',
          go: 'go',
          java: 'java',
          rb: 'ruby',
          php: 'php',
          cs: 'csharp',
          cpp: 'cpp',
          c: 'c',
          sql: 'sql',
          yml: 'yaml',
          yaml: 'yaml',
          json: 'json',
          md: 'markdown',
          css: 'css',
          scss: 'sass',
          html: 'html',
        };
        const tech = techMap[ext];
        if (tech) {
          technologies.add(tech);
        }
      }
    }

    // Extract from approach description
    const approachLower = plan.approach.toLowerCase();
    const commonTechs = [
      'react', 'vue', 'angular', 'svelte', 'nextjs', 'express',
      'fastapi', 'django', 'flask', 'spring', 'rails',
      'postgresql', 'mysql', 'mongodb', 'redis', 'elasticsearch',
      'docker', 'kubernetes', 'terraform', 'aws', 'gcp', 'azure',
      'graphql', 'rest', 'grpc', 'websocket',
    ];
    for (const tech of commonTechs) {
      if (approachLower.includes(tech)) {
        technologies.add(tech);
      }
    }

    return Array.from(technologies);
  }

  /**
   * Update checker options
   */
  setOptions(options: Partial<PreTaskCheckerOptions>): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * Get current options
   */
  getOptions(): PreTaskCheckerOptions {
    return { ...this.options };
  }
}

/**
 * Knowledge Base Module
 *
 * Agent knowledge base for storing and serving recommendations,
 * prohibited actions, and learnings to agents.
 *
 * @module @tamma/intelligence/knowledge-base
 *
 * @example
 * ```typescript
 * import { KnowledgeService, InMemoryKnowledgeStore } from '@tamma/intelligence';
 *
 * // Create knowledge service
 * const service = new KnowledgeService();
 * await service.initialize();
 *
 * // Add knowledge entries
 * await service.addKnowledge({
 *   type: 'recommendation',
 *   title: 'Use TypeScript strict mode',
 *   description: 'Always enable strict mode for better type safety',
 *   keywords: ['typescript', 'strict', 'type safety'],
 *   scope: 'global',
 *   priority: 'high',
 *   source: 'manual',
 *   createdBy: 'admin',
 *   enabled: true,
 * });
 *
 * // Query relevant knowledge
 * const result = await service.getRelevantKnowledge({
 *   taskType: 'implement_feature',
 *   taskDescription: 'Add new TypeScript service',
 *   projectId: 'my-project',
 *   agentType: 'implementer',
 * });
 *
 * // Check before task execution
 * const check = await service.checkBeforeTask(task, plan);
 * if (!check.canProceed) {
 *   console.log('Blocked:', check.blockers);
 * }
 * ```
 */

// Types
export type {
  // Service interfaces
  IKnowledgeService,
  IKnowledgeStore,
  IKnowledgeMatcher,
  IRelevanceRanker,
  IEmbeddingProvider,
  // Configuration
  KnowledgeConfig,
  KnowledgeStorageConfig,
  LearningCaptureConfig,
  MatchingConfig,
  PreTaskCheckConfig,
  RetentionConfig,
  // Context types
  TaskContext,
  DevelopmentPlan,
  MatchContext,
  MatchResult,
  RankedEntry,
  // Store types
  KnowledgeStoreQuery,
  EmbeddingSearchOptions,
} from './types.js';

export { DEFAULT_KNOWLEDGE_CONFIG } from './types.js';

// Main service
export { KnowledgeService } from './knowledge-service.js';

// Stores
export { InMemoryKnowledgeStore } from './stores/index.js';

// Matchers
export {
  KeywordMatcher,
  PatternMatcher,
  SemanticMatcher,
  RelevanceRanker,
  combineMatchResults,
  type KeywordMatcherOptions,
  type PatternMatcherOptions,
  type SemanticMatcherOptions,
  type RelevanceRankerOptions,
} from './matchers/index.js';

// Checkers
export {
  PreTaskChecker,
  type PreTaskCheckerOptions,
} from './checkers/index.js';

// Capture
export {
  LearningCaptureService,
  DuplicateDetector,
  type TaskOutcome,
  type DuplicateDetectorOptions,
} from './capture/index.js';

// Prompt
export {
  KnowledgePromptBuilder,
  type PromptBuilderOptions,
} from './prompt/index.js';

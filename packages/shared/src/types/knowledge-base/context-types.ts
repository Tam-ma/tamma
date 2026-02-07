/**
 * Context Testing Types
 *
 * Types for the interactive context testing interface.
 */

/** Available context retrieval sources */
export type UIContextSource = 'vector_db' | 'rag' | 'mcp' | 'web_search' | 'live_api';

/** Task types for context retrieval */
export type UITaskType =
  | 'analysis'
  | 'planning'
  | 'implementation'
  | 'review'
  | 'testing'
  | 'documentation';

/** Request to test context retrieval */
export interface ContextTestRequest {
  query: string;
  taskType: UITaskType;
  maxTokens: number;
  sources?: UIContextSource[];
  hints?: ContextTestHints;
  options?: ContextTestOptions;
}

/** Hints for improved context retrieval */
export interface ContextTestHints {
  relatedFiles?: string[];
  relatedIssues?: number[];
  language?: string;
  framework?: string;
}

/** Processing options for context testing */
export interface ContextTestOptions {
  deduplicate?: boolean;
  compress?: boolean;
  summarize?: boolean;
  includeMetadata?: boolean;
}

/** Result from a context test */
export interface ContextTestResult {
  requestId: string;
  context: UIAssembledContext;
  sources: UISourceContribution[];
  metrics: UIContextMetrics;
}

/** Assembled context output */
export interface UIAssembledContext {
  text: string;
  chunks: UIContextChunk[];
  tokenCount: number;
  format: 'xml' | 'markdown' | 'plain';
}

/** A single context chunk */
export interface UIContextChunk {
  id: string;
  content: string;
  source: UIContextSource;
  relevance: number;
  metadata: UIChunkMetadata;
}

/** Chunk metadata */
export interface UIChunkMetadata {
  filePath?: string;
  startLine?: number;
  endLine?: number;
  language?: string;
  symbolName?: string;
}

/** Source contribution details */
export interface UISourceContribution {
  source: UIContextSource;
  chunksProvided: number;
  tokensUsed: number;
  latencyMs: number;
  cacheHit: boolean;
}

/** Context retrieval metrics */
export interface UIContextMetrics {
  totalLatencyMs: number;
  totalTokens: number;
  budgetUtilization: number;
  deduplicationRate: number;
  cacheHitRate: number;
}

/** Relevance feedback for a chunk */
export interface RelevanceFeedbackInput {
  chunkId: string;
  rating: 'relevant' | 'irrelevant' | 'partially_relevant';
  comment?: string;
}

/** Feedback submission request */
export interface ContextFeedbackRequest {
  requestId: string;
  feedback: RelevanceFeedbackInput[];
}

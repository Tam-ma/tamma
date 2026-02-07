/**
 * RAG Pipeline Types
 *
 * Types for RAG pipeline configuration, testing, and metrics.
 */

/** RAG pipeline configuration */
export interface RAGConfigInfo {
  sources: RAGSourceConfigInfo;
  ranking: RankingConfigInfo;
  assembly: AssemblyConfigInfo;
  caching: CachingConfigInfo;
}

/** Source configuration for RAG */
export interface RAGSourceConfigInfo {
  vectorDb: { enabled: boolean; weight: number; topK: number };
  keyword: { enabled: boolean; weight: number; topK: number };
  docs: { enabled: boolean; weight: number; topK: number };
  issues: { enabled: boolean; weight: number; topK: number };
}

/** Ranking configuration for RAG */
export interface RankingConfigInfo {
  fusionMethod: 'rrf' | 'linear' | 'learned';
  mmrLambda: number;
  recencyBoost: number;
}

/** Assembly configuration for RAG */
export interface AssemblyConfigInfo {
  maxTokens: number;
  format: 'xml' | 'markdown' | 'plain';
  includeScores: boolean;
}

/** Caching configuration for RAG */
export interface CachingConfigInfo {
  enabled: boolean;
  ttlSeconds: number;
  maxEntries: number;
}

/** RAG pipeline metrics */
export interface RAGMetricsInfo {
  totalQueries: number;
  avgLatencyMs: number;
  cacheHitRate: number;
  avgTokensRetrieved: number;
  sourceBreakdown: Record<string, number>;
}

/** Request to test a RAG query */
export interface RAGTestRequest {
  query: string;
  sources?: string[];
  maxTokens?: number;
  topK?: number;
}

/** Result from a RAG test query */
export interface RAGTestResult {
  queryId: string;
  chunks: RAGRetrievedChunk[];
  assembledContext: string;
  tokenCount: number;
  latencyMs: number;
  sources: RAGSourceAttribution[];
}

/** A retrieved chunk from a RAG query */
export interface RAGRetrievedChunk {
  id: string;
  content: string;
  source: string;
  score: number;
  metadata: {
    filePath?: string;
    startLine?: number;
    endLine?: number;
    url?: string;
    date?: string;
  };
}

/** Source contribution in a RAG result */
export interface RAGSourceAttribution {
  source: string;
  count: number;
  avgScore: number;
  tokensUsed: number;
}

/**
 * RAG Pipeline Service Contract
 *
 * Defines the interface for RAG pipeline configuration and testing.
 */

import type {
  RAGConfigInfo,
  RAGMetricsInfo,
  RAGTestRequest,
  RAGTestResult,
} from '../../types/knowledge-base/rag-types.js';

export interface IRAGService {
  getConfig(): Promise<RAGConfigInfo>;
  updateConfig(config: Partial<RAGConfigInfo>): Promise<RAGConfigInfo>;
  getMetrics(): Promise<RAGMetricsInfo>;
  testQuery(request: RAGTestRequest): Promise<RAGTestResult>;
}

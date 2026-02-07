/**
 * Context Testing Service
 *
 * Provides interactive context retrieval testing and feedback collection.
 */

import { randomUUID } from 'node:crypto';
import type {
  ContextTestRequest,
  ContextTestResult,
  ContextFeedbackRequest,
  UIContextChunk,
  UIContextSource,
} from '@tamma/shared';

export class ContextTestingService {
  private testHistory: ContextTestResult[] = [];
  private feedback: Map<string, ContextFeedbackRequest> = new Map();

  async testContext(request: ContextTestRequest): Promise<ContextTestResult> {
    const startTime = Date.now();
    const requestId = randomUUID();
    const sources = request.sources ?? ['vector_db', 'rag'] as UIContextSource[];

    const chunks: UIContextChunk[] = [];
    let chunkIndex = 0;

    for (const source of sources) {
      const count = source === 'vector_db' ? 3 : source === 'rag' ? 2 : 1;
      for (let i = 0; i < count; i++) {
        chunks.push({
          id: randomUUID(),
          content: `// Context from ${source}, chunk ${i + 1}\n// Matching query: "${request.query}"\nexport function handler${chunkIndex}() {\n  // Implementation related to the query\n  console.log('${source} result ${i + 1}');\n}`,
          source: source as UIContextSource,
          relevance: 0.95 - chunkIndex * 0.05,
          metadata: {
            filePath: `src/${source}/handler-${i + 1}.ts`,
            startLine: 1,
            endLine: 6,
            language: 'typescript',
          },
        });
        chunkIndex++;
      }
    }

    const assembledText = chunks.map((c) => c.content).join('\n\n');
    const tokenCount = Math.ceil(assembledText.length / 4);
    const totalLatencyMs = Date.now() - startTime + Math.floor(Math.random() * 150);

    const sourceContributions = sources.map((source) => {
      const sourceChunks = chunks.filter((c) => c.source === source);
      return {
        source: source as UIContextSource,
        chunksProvided: sourceChunks.length,
        tokensUsed: sourceChunks.length * Math.floor(tokenCount / chunks.length),
        latencyMs: Math.floor(totalLatencyMs * 0.4) + Math.floor(Math.random() * 50),
        cacheHit: Math.random() > 0.6,
      };
    });

    const result: ContextTestResult = {
      requestId,
      context: {
        text: assembledText,
        chunks,
        tokenCount,
        format: request.options?.includeMetadata ? 'xml' : 'markdown',
      },
      sources: sourceContributions,
      metrics: {
        totalLatencyMs,
        totalTokens: tokenCount,
        budgetUtilization: Math.min(tokenCount / request.maxTokens, 1),
        deduplicationRate: 0.15,
        cacheHitRate: sourceContributions.filter((s) => s.cacheHit).length / sourceContributions.length,
      },
    };

    this.testHistory.unshift(result);
    if (this.testHistory.length > 50) {
      this.testHistory.pop();
    }

    return result;
  }

  async submitFeedback(feedbackRequest: ContextFeedbackRequest): Promise<void> {
    this.feedback.set(feedbackRequest.requestId, feedbackRequest);
  }

  async getRecentTests(limit = 10): Promise<ContextTestResult[]> {
    return this.testHistory.slice(0, limit);
  }
}

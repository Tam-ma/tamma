/**
 * Semantic Matcher
 *
 * Matches knowledge entries based on semantic similarity using embeddings.
 */

import type { KnowledgeEntry } from '@tamma/shared';
import type {
  IKnowledgeMatcher,
  MatchContext,
  MatchResult,
  IEmbeddingProvider,
} from '../types.js';

/**
 * Options for semantic matching
 */
export interface SemanticMatcherOptions {
  /** Minimum similarity threshold (0-1) */
  threshold: number;
  /** Weight for different context components */
  weights: {
    taskDescription: number;
    planApproach: number;
    technologies: number;
    filePaths: number;
  };
}

/**
 * Default semantic matcher options
 */
const DEFAULT_OPTIONS: SemanticMatcherOptions = {
  threshold: 0.7,
  weights: {
    taskDescription: 1.0,
    planApproach: 0.8,
    technologies: 0.6,
    filePaths: 0.4,
  },
};

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Semantic knowledge matcher using embeddings
 */
export class SemanticMatcher implements IKnowledgeMatcher {
  private options: SemanticMatcherOptions;
  private embeddingProvider: IEmbeddingProvider | null;

  constructor(
    embeddingProvider?: IEmbeddingProvider,
    options?: Partial<SemanticMatcherOptions>
  ) {
    this.embeddingProvider = embeddingProvider ?? null;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Set the embedding provider
   */
  setEmbeddingProvider(provider: IEmbeddingProvider): void {
    this.embeddingProvider = provider;
  }

  /**
   * Check if semantic matching is available
   */
  isAvailable(): boolean {
    return this.embeddingProvider !== null;
  }

  async match(
    entry: KnowledgeEntry,
    context: MatchContext
  ): Promise<MatchResult | null> {
    // Skip if no embedding on entry
    if (!entry.embedding || entry.embedding.length === 0) {
      return null;
    }

    // Skip if no embedding provider
    if (!this.embeddingProvider) {
      return null;
    }

    // Build context text for embedding
    const contextParts: Array<{ text: string; weight: number }> = [];

    if (context.taskDescription) {
      contextParts.push({
        text: context.taskDescription,
        weight: this.options.weights.taskDescription,
      });
    }

    if (context.planApproach) {
      contextParts.push({
        text: context.planApproach,
        weight: this.options.weights.planApproach,
      });
    }

    if (context.technologies && context.technologies.length > 0) {
      contextParts.push({
        text: `Technologies: ${context.technologies.join(', ')}`,
        weight: this.options.weights.technologies,
      });
    }

    if (context.filePaths && context.filePaths.length > 0) {
      contextParts.push({
        text: `Files: ${context.filePaths.slice(0, 10).join(', ')}`,
        weight: this.options.weights.filePaths,
      });
    }

    if (contextParts.length === 0) {
      return null;
    }

    // Calculate weighted average similarity
    let totalSimilarity = 0;
    let totalWeight = 0;

    try {
      for (const part of contextParts) {
        const contextEmbedding = await this.embeddingProvider.embed(part.text);
        const similarity = cosineSimilarity(entry.embedding, contextEmbedding);
        totalSimilarity += similarity * part.weight;
        totalWeight += part.weight;
      }
    } catch {
      // Embedding generation failed, skip semantic matching
      return null;
    }

    if (totalWeight === 0) {
      return null;
    }

    const averageSimilarity = totalSimilarity / totalWeight;

    // Check threshold
    if (averageSimilarity < this.options.threshold) {
      return null;
    }

    // Determine match reason based on what contributed most
    const contributingParts = contextParts
      .map((p) => p.text.substring(0, 30) + (p.text.length > 30 ? '...' : ''))
      .slice(0, 2);

    return {
      matched: true,
      score: averageSimilarity,
      reason: `Semantic similarity: ${(averageSimilarity * 100).toFixed(1)}% with context: ${contributingParts.join(', ')}`,
      matchType: 'semantic',
    };
  }

  /**
   * Match entry against pre-computed context embedding
   */
  matchWithEmbedding(
    entry: KnowledgeEntry,
    contextEmbedding: number[]
  ): MatchResult | null {
    if (!entry.embedding || entry.embedding.length === 0) {
      return null;
    }

    const similarity = cosineSimilarity(entry.embedding, contextEmbedding);

    if (similarity < this.options.threshold) {
      return null;
    }

    return {
      matched: true,
      score: similarity,
      reason: `Semantic similarity: ${(similarity * 100).toFixed(1)}%`,
      matchType: 'semantic',
    };
  }
}

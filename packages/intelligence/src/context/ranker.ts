import type { ContextChunk, ContextRequest } from './types.js';
import { estimateTokensSimple } from '../indexer/metadata/token-counter.js';

export class ChunkRanker {
  rank(chunks: ContextChunk[], request: ContextRequest): ContextChunk[] {
    const scored = chunks.map(chunk => ({
      chunk,
      score: this.computeScore(chunk, request),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.map(s => ({ ...s.chunk, relevance: s.score }));
  }

  selectWithinBudget(rankedChunks: ContextChunk[], maxTokens: number): ContextChunk[] {
    const selected: ContextChunk[] = [];
    let totalTokens = 0;
    for (const chunk of rankedChunks) {
      const tokens = chunk.tokenCount ?? estimateTokensSimple(chunk.content);
      if (totalTokens + tokens > maxTokens) break;
      selected.push({ ...chunk, tokenCount: tokens });
      totalTokens += tokens;
    }
    return selected;
  }

  private computeScore(chunk: ContextChunk, request: ContextRequest): number {
    let score = chunk.relevance;
    if (request.hints?.relatedFiles?.length) {
      const fp = chunk.metadata.filePath;
      if (fp && request.hints.relatedFiles.some(f => fp.includes(f))) {
        score *= 1.3;
      }
    }
    if (request.hints?.language && chunk.metadata.language === request.hints.language) {
      score *= 1.1;
    }
    return Math.min(1, score);
  }
}

export function createChunkRanker(): ChunkRanker { return new ChunkRanker(); }

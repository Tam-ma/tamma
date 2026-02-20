import type { ContextChunk, DeduplicationConfig } from './types.js';

export interface DeduplicationResult {
  chunks: ContextChunk[];
  removedCount: number;
}

export class Deduplicator {
  async deduplicate(
    chunks: ContextChunk[],
    config: DeduplicationConfig
  ): Promise<DeduplicationResult> {
    if (!config.enabled || chunks.length <= 1) {
      return { chunks, removedCount: 0 };
    }

    let result = chunks;
    let totalRemoved = 0;

    if (config.useContentHash) {
      const { unique, removed } = this.hashDeduplicate(result);
      result = unique;
      totalRemoved += removed;
    }

    // Phase 2: Merge overlapping code chunks from the same file
    {
      const { unique, removed } = this.mergeOverlappingChunks(result);
      result = unique;
      totalRemoved += removed;
    }

    if (config.useSemantic && result.length > 1) {
      const { unique, removed } = this.semanticDeduplicate(result, config.similarityThreshold);
      result = unique;
      totalRemoved += removed;
    }

    return { chunks: result, removedCount: totalRemoved };
  }

  hashDeduplicate(chunks: ContextChunk[]): { unique: ContextChunk[]; removed: number } {
    const seen = new Set<string>();
    const unique: ContextChunk[] = [];
    for (const chunk of chunks) {
      const hash = this.computeHash(chunk.content);
      if (!seen.has(hash)) {
        seen.add(hash);
        unique.push(chunk);
      }
    }
    return { unique, removed: chunks.length - unique.length };
  }

  semanticDeduplicate(
    chunks: ContextChunk[],
    threshold: number
  ): { unique: ContextChunk[]; removed: number } {
    const withEmb = chunks.filter(c => c.embedding && c.embedding.length > 0);
    const noEmb = chunks.filter(c => !c.embedding || c.embedding.length === 0);
    if (withEmb.length <= 1) return { unique: chunks, removed: 0 };
    const merged: ContextChunk[] = [];
    const used = new Set<number>();
    for (let i = 0; i < withEmb.length; i++) {
      if (used.has(i)) continue;
      const chunkI = withEmb[i]!;
      const group: ContextChunk[] = [chunkI];
      used.add(i);
      for (let j = i + 1; j < withEmb.length; j++) {
        if (used.has(j)) continue;
        const chunkJ = withEmb[j]!;
        if (this.cosineSimilarity(chunkI.embedding!, chunkJ.embedding!) >= threshold) {
          group.push(chunkJ);
          used.add(j);
        }
      }
      merged.push(group.reduce((a, b) => a.relevance > b.relevance ? a : b));
    }
    return { unique: [...merged, ...noEmb], removed: chunks.length - merged.length - noEmb.length };
  }

  /**
   * Merge overlapping code chunks that originate from the same file and
   * share overlapping line ranges. Keeps the higher-relevance version
   * when chunks overlap by more than 50% of the smaller chunk.
   */
  mergeOverlappingChunks(
    chunks: ContextChunk[]
  ): { unique: ContextChunk[]; removed: number } {
    // Separate chunks that have file-based line ranges from those that don't
    const withRange: ContextChunk[] = [];
    const withoutRange: ContextChunk[] = [];

    for (const chunk of chunks) {
      const { filePath, startLine, endLine } = chunk.metadata;
      if (filePath && startLine !== undefined && endLine !== undefined) {
        withRange.push(chunk);
      } else {
        withoutRange.push(chunk);
      }
    }

    if (withRange.length <= 1) {
      return { unique: chunks, removed: 0 };
    }

    // Group by filePath
    const byFile = new Map<string, ContextChunk[]>();
    for (const chunk of withRange) {
      const fp = chunk.metadata.filePath!;
      const list = byFile.get(fp) ?? [];
      list.push(chunk);
      byFile.set(fp, list);
    }

    const merged: ContextChunk[] = [];

    for (const [, fileChunks] of byFile) {
      // Sort by startLine ascending
      fileChunks.sort((a, b) => a.metadata.startLine! - b.metadata.startLine!);

      const used = new Set<number>();
      for (let i = 0; i < fileChunks.length; i++) {
        if (used.has(i)) continue;
        let best = fileChunks[i]!;
        used.add(i);

        for (let j = i + 1; j < fileChunks.length; j++) {
          if (used.has(j)) continue;
          const other = fileChunks[j]!;
          const overlapLines = this.lineOverlap(
            best.metadata.startLine!, best.metadata.endLine!,
            other.metadata.startLine!, other.metadata.endLine!
          );
          const smallerSpan = Math.min(
            best.metadata.endLine! - best.metadata.startLine! + 1,
            other.metadata.endLine! - other.metadata.startLine! + 1
          );
          if (overlapLines > 0 && overlapLines >= smallerSpan * 0.5) {
            // Merge: keep higher-relevance chunk
            best = best.relevance >= other.relevance ? best : other;
            used.add(j);
          }
        }
        merged.push(best);
      }
    }

    const result = [...merged, ...withoutRange];
    return { unique: result, removed: chunks.length - result.length };
  }

  private lineOverlap(
    startA: number, endA: number,
    startB: number, endB: number
  ): number {
    const overlapStart = Math.max(startA, startB);
    const overlapEnd = Math.min(endA, endB);
    return Math.max(0, overlapEnd - overlapStart + 1);
  }

  computeHash(content: string): string {
    const n = content.trim().replace(/\s+/g, ' ');
    let h = 2166136261;
    for (let i = 0; i < n.length; i++) {
      h ^= n.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0, nA = 0, nB = 0;
    for (let i = 0; i < a.length; i++) {
      const ai = a[i]!;
      const bi = b[i]!;
      dot += ai * bi;
      nA += ai * ai;
      nB += bi * bi;
    }
    const d = Math.sqrt(nA) * Math.sqrt(nB);
    return d === 0 ? 0 : dot / d;
  }
}

export function createDeduplicator(): Deduplicator {
  return new Deduplicator();
}

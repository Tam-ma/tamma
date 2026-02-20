import type { ContextSourceType, SourceQuery, ContextChunk } from '../types.js';
import type { IVectorStore, SearchResult } from '../../vector-store/interfaces.js';
import { BaseContextSource } from './base-source.js';

export class VectorDBSource extends BaseContextSource {
  readonly name: ContextSourceType = 'vector_db';
  private vectorStore: IVectorStore;
  private collectionName: string;

  constructor(vectorStore: IVectorStore, collectionName: string = 'codebase') {
    super();
    this.vectorStore = vectorStore;
    this.collectionName = collectionName;
  }

  protected async doRetrieve(query: SourceQuery): Promise<ContextChunk[]> {
    if (!query.embedding || query.embedding.length === 0) {
      return [];
    }

    const results = await this.vectorStore.search(this.collectionName, {
      embedding: query.embedding,
      topK: query.maxChunks,
      includeContent: true,
      includeMetadata: true,
    });

    return results.map((r: SearchResult): ContextChunk => {
      const metadata: ContextChunk['metadata'] = {};
      if (r.metadata?.filePath != null) metadata.filePath = r.metadata.filePath;
      if (r.metadata?.startLine != null) metadata.startLine = r.metadata.startLine;
      if (r.metadata?.endLine != null) metadata.endLine = r.metadata.endLine;
      if (r.metadata?.language != null) metadata.language = r.metadata.language;
      if (r.metadata?.name != null) metadata.symbolName = r.metadata.name;
      if (r.metadata?.chunkType != null) {
        const ct = r.metadata.chunkType;
        if (ct === 'function' || ct === 'class' || ct === 'module' || ct === 'block') {
          metadata.symbolType = ct;
        }
      }

      return {
        id: r.id,
        content: r.content ?? '',
        source: 'vector_db' as const,
        relevance: r.score,
        metadata,
        ...(r.embedding ? { embedding: r.embedding } : {}),
      };
    });
  }
}

export function createVectorDBSource(vectorStore: IVectorStore, collectionName?: string): VectorDBSource {
  return new VectorDBSource(vectorStore, collectionName);
}

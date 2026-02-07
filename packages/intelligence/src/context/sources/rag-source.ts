import type { ContextSourceType, SourceQuery, ContextChunk } from '../types.js';
import type { IRAGPipeline } from '../../rag/types.js';
import { BaseContextSource } from './base-source.js';

export class RAGSource extends BaseContextSource {
  readonly name: ContextSourceType = 'rag';
  private ragPipeline: IRAGPipeline;

  constructor(ragPipeline: IRAGPipeline) {
    super();
    this.ragPipeline = ragPipeline;
  }

  protected async doRetrieve(query: SourceQuery): Promise<ContextChunk[]> {
    const lang = query.filters?.languages?.[0];
    const result = await this.ragPipeline.retrieve({
      text: query.text,
      maxTokens: query.maxTokens,
      topK: query.maxChunks,
      ...(lang ? { context: { language: lang } } : {}),
    });

    return result.retrievedChunks.map((chunk): ContextChunk => {
      const metadata: ContextChunk['metadata'] = {};
      if (chunk.metadata.filePath != null) metadata.filePath = chunk.metadata.filePath;
      if (chunk.metadata.startLine != null) metadata.startLine = chunk.metadata.startLine;
      if (chunk.metadata.endLine != null) metadata.endLine = chunk.metadata.endLine;
      if (chunk.metadata.language != null) metadata.language = chunk.metadata.language;
      if (chunk.metadata.url != null) metadata.url = chunk.metadata.url;
      if (chunk.metadata.title != null) metadata.title = chunk.metadata.title;
      if (chunk.metadata.date != null) metadata.date = chunk.metadata.date;

      return {
        id: chunk.id,
        content: chunk.content,
        source: 'rag' as const,
        relevance: chunk.fusedScore ?? chunk.score,
        metadata,
        ...(chunk.embedding ? { embedding: chunk.embedding } : {}),
      };
    });
  }
}

export function createRAGSource(ragPipeline: IRAGPipeline): RAGSource {
  return new RAGSource(ragPipeline);
}

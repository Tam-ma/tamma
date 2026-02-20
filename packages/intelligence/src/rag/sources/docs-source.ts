/**
 * Documentation Source
 *
 * Retrieves chunks from documentation files (markdown, text, etc.).
 */

import type {
  RAGSourceType,
  SourceSettings,
  ProcessedQuery,
  RetrieveOptions,
  RetrievedChunk,
  ChunkMetadata,
} from '../types.js';
import { BaseRAGSource } from './source-interface.js';
import { KeywordSource } from './keyword-source.js';

/**
 * Documentation entry
 */
export interface DocEntry {
  id: string;
  title: string;
  content: string;
  filePath: string;
  section?: string;
  url?: string;
}

/**
 * Documentation source adapter
 *
 * Uses keyword search for documentation retrieval.
 * Can be extended to integrate with external documentation systems.
 */
export class DocsSource extends BaseRAGSource {
  readonly name: RAGSourceType = 'docs';
  private keywordIndex: KeywordSource;
  private docs: Map<string, DocEntry>;

  constructor() {
    super();
    this.keywordIndex = new KeywordSource();
    this.docs = new Map();
  }

  protected async doInitialize(config: SourceSettings): Promise<void> {
    await this.keywordIndex.initialize(config);
  }

  protected async doRetrieve(
    query: ProcessedQuery,
    options: RetrieveOptions
  ): Promise<RetrievedChunk[]> {
    const results = await this.keywordIndex.retrieve(query, options);

    // Enhance results with doc-specific metadata
    return results.map((chunk) => {
      const doc = this.docs.get(chunk.id);
      return {
        ...chunk,
        source: this.name,
        metadata: {
          ...chunk.metadata,
          title: doc?.title,
          url: doc?.url,
        },
      };
    });
  }

  protected async doHealthCheck(): Promise<boolean> {
    return this.keywordIndex.healthCheck();
  }

  protected async doDispose(): Promise<void> {
    await this.keywordIndex.dispose();
    this.docs.clear();
  }

  /**
   * Add a documentation entry
   */
  addDoc(entry: DocEntry): void {
    this.docs.set(entry.id, entry);

    // Build searchable text
    const searchText = this.buildSearchText(entry);

    this.keywordIndex.addDocument({
      id: entry.id,
      content: searchText,
      metadata: this.buildMetadata(entry),
    });
  }

  /**
   * Add multiple documentation entries
   */
  addDocs(entries: DocEntry[]): void {
    for (const entry of entries) {
      this.addDoc(entry);
    }
  }

  /**
   * Remove a documentation entry
   */
  removeDoc(id: string): void {
    this.docs.delete(id);
    this.keywordIndex.removeDocument(id);
  }

  /**
   * Clear all documentation entries
   */
  clear(): void {
    this.docs.clear();
    this.keywordIndex.clear();
  }

  /**
   * Get the number of indexed documents
   */
  get size(): number {
    return this.docs.size;
  }

  /**
   * Build searchable text from doc entry
   */
  private buildSearchText(entry: DocEntry): string {
    const parts: string[] = [];

    if (entry.title) {
      // Weight title higher by repeating
      parts.push(entry.title);
      parts.push(entry.title);
    }

    if (entry.section) {
      parts.push(entry.section);
    }

    parts.push(entry.content);

    return parts.join('\n');
  }

  /**
   * Build metadata from doc entry
   */
  private buildMetadata(entry: DocEntry): ChunkMetadata {
    return {
      filePath: entry.filePath,
      title: entry.title,
      url: entry.url,
    };
  }
}

/**
 * Create a docs source instance
 */
export function createDocsSource(): DocsSource {
  return new DocsSource();
}

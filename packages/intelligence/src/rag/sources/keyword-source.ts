/**
 * Keyword/BM25 Source
 *
 * Retrieves chunks using keyword-based search (BM25 algorithm).
 * Provides sparse retrieval to complement dense vector search.
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

/**
 * Document stored in the keyword index
 */
export interface KeywordDocument {
  id: string;
  content: string;
  metadata: ChunkMetadata;
}

/**
 * BM25 parameters
 */
interface BM25Params {
  k1: number;  // Term frequency saturation parameter (typical: 1.2-2.0)
  b: number;   // Length normalization parameter (typical: 0.75)
}

/**
 * Internal document statistics for BM25
 */
interface DocumentStats {
  termFrequencies: Map<string, number>;
  length: number;
}

/**
 * Keyword source using BM25 algorithm
 *
 * This is an in-memory implementation suitable for moderate-sized codebases.
 * For larger deployments, consider integrating with Elasticsearch or Meilisearch.
 */
export class KeywordSource extends BaseRAGSource {
  readonly name: RAGSourceType = 'keyword';

  private documents: Map<string, KeywordDocument>;
  private documentStats: Map<string, DocumentStats>;
  private documentFrequencies: Map<string, number>;
  private avgDocLength: number;
  private params: BM25Params;

  constructor(params?: Partial<BM25Params>) {
    super();
    this.documents = new Map();
    this.documentStats = new Map();
    this.documentFrequencies = new Map();
    this.avgDocLength = 0;
    this.params = {
      k1: params?.k1 ?? 1.5,
      b: params?.b ?? 0.75,
    };
  }

  protected async doInitialize(_config: SourceSettings): Promise<void> {
    // No special initialization needed for in-memory index
  }

  protected async doRetrieve(
    query: ProcessedQuery,
    options: RetrieveOptions
  ): Promise<RetrievedChunk[]> {
    if (this.documents.size === 0) {
      return [];
    }

    // Tokenize query
    const queryTerms = this.tokenize(query.original);

    // Include expanded terms
    const allTerms = new Set<string>(queryTerms);
    for (const expanded of query.expanded) {
      for (const term of this.tokenize(expanded)) {
        allTerms.add(term);
      }
    }

    // Calculate BM25 scores for all documents
    const scores: Array<{ id: string; score: number }> = [];

    for (const [docId, stats] of this.documentStats) {
      const score = this.calculateBM25Score(Array.from(allTerms), stats);
      if (score > 0) {
        scores.push({ id: docId, score });
      }
    }

    // Sort by score descending
    scores.sort((a, b) => b.score - a.score);

    // Apply filters and take top-K
    const filtered = this.applyFilters(scores, options.filter);
    const topK = filtered.slice(0, options.topK);

    // Transform to RetrievedChunk format
    return topK.map(({ id, score }) => {
      const doc = this.documents.get(id)!;
      return {
        id,
        content: doc.content,
        source: this.name,
        score,
        metadata: doc.metadata,
      };
    });
  }

  protected async doHealthCheck(): Promise<boolean> {
    return true; // In-memory store is always "healthy"
  }

  protected async doDispose(): Promise<void> {
    this.clear();
  }

  /**
   * Add a document to the index
   */
  addDocument(doc: KeywordDocument): void {
    const terms = this.tokenize(doc.content);
    const termFreqs = new Map<string, number>();

    for (const term of terms) {
      termFreqs.set(term, (termFreqs.get(term) ?? 0) + 1);
    }

    // Update document frequencies
    for (const term of termFreqs.keys()) {
      this.documentFrequencies.set(term, (this.documentFrequencies.get(term) ?? 0) + 1);
    }

    this.documents.set(doc.id, doc);
    this.documentStats.set(doc.id, {
      termFrequencies: termFreqs,
      length: terms.length,
    });

    // Recalculate average document length
    this.updateAvgDocLength();
  }

  /**
   * Add multiple documents to the index
   */
  addDocuments(docs: KeywordDocument[]): void {
    for (const doc of docs) {
      this.addDocument(doc);
    }
  }

  /**
   * Remove a document from the index
   */
  removeDocument(id: string): void {
    const stats = this.documentStats.get(id);
    if (!stats) {
      return;
    }

    // Update document frequencies
    for (const term of stats.termFrequencies.keys()) {
      const df = this.documentFrequencies.get(term) ?? 0;
      if (df <= 1) {
        this.documentFrequencies.delete(term);
      } else {
        this.documentFrequencies.set(term, df - 1);
      }
    }

    this.documents.delete(id);
    this.documentStats.delete(id);
    this.updateAvgDocLength();
  }

  /**
   * Clear the entire index
   */
  clear(): void {
    this.documents.clear();
    this.documentStats.clear();
    this.documentFrequencies.clear();
    this.avgDocLength = 0;
  }

  /**
   * Get the number of indexed documents
   */
  get size(): number {
    return this.documents.size;
  }

  /**
   * Tokenize text into terms
   */
  private tokenize(text: string): string[] {
    // Split camelCase identifiers before lowercasing
    const prepared = text.replace(/([a-z])([A-Z])/g, '$1 $2');
    return prepared
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((term) => term.length >= 2);
  }

  /**
   * Calculate BM25 score for a document given query terms
   */
  private calculateBM25Score(queryTerms: string[], docStats: DocumentStats): number {
    const { k1, b } = this.params;
    const N = this.documents.size;
    let score = 0;

    for (const term of queryTerms) {
      const tf = docStats.termFrequencies.get(term) ?? 0;
      if (tf === 0) {
        continue;
      }

      const df = this.documentFrequencies.get(term) ?? 0;
      if (df === 0) {
        continue;
      }

      // IDF component
      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);

      // TF component with length normalization
      const lengthNorm = 1 - b + b * (docStats.length / this.avgDocLength);
      const tfNorm = (tf * (k1 + 1)) / (tf + k1 * lengthNorm);

      score += idf * tfNorm;
    }

    return score;
  }

  /**
   * Apply filters to scored results
   */
  private applyFilters(
    scores: Array<{ id: string; score: number }>,
    filter?: RetrieveOptions['filter']
  ): Array<{ id: string; score: number }> {
    if (!filter) {
      return scores;
    }

    return scores.filter(({ id }) => {
      const doc = this.documents.get(id);
      if (!doc) {
        return false;
      }

      // Filter by file paths
      if (filter.filePaths?.length) {
        if (!doc.metadata.filePath) {
          return false;
        }
        const matches = filter.filePaths.some((fp) =>
          doc.metadata.filePath?.includes(fp)
        );
        if (!matches) {
          return false;
        }
      }

      // Filter by languages
      if (filter.languages?.length) {
        if (!doc.metadata.language) {
          return false;
        }
        if (!filter.languages.includes(doc.metadata.language)) {
          return false;
        }
      }

      // Filter by date range
      if (filter.dateRange && doc.metadata.date) {
        const docDate = new Date(doc.metadata.date);
        if (docDate < filter.dateRange.start || docDate > filter.dateRange.end) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Update average document length
   */
  private updateAvgDocLength(): void {
    if (this.documentStats.size === 0) {
      this.avgDocLength = 0;
      return;
    }

    let totalLength = 0;
    for (const stats of this.documentStats.values()) {
      totalLength += stats.length;
    }
    this.avgDocLength = totalLength / this.documentStats.size;
  }
}

/**
 * Create a keyword source instance
 */
export function createKeywordSource(params?: Partial<BM25Params>): KeywordSource {
  return new KeywordSource(params);
}

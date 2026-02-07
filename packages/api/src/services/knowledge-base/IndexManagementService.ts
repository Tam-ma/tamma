/**
 * Index Management Service
 *
 * Manages codebase indexing operations including status tracking,
 * triggering re-indexes, history, and configuration.
 */

import { randomUUID } from 'node:crypto';
import type {
  IndexStatus,
  IndexHistoryEntry,
  IndexConfig,
  TriggerIndexRequest,
} from '@tamma/shared';

/** Default index configuration */
const DEFAULT_INDEX_CONFIG: IndexConfig = {
  includePatterns: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.md'],
  excludePatterns: ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/coverage/**'],
  chunkingConfig: {
    maxTokens: 500,
    overlapTokens: 50,
    preserveImports: true,
    groupRelatedCode: true,
  },
  embeddingConfig: {
    provider: 'openai',
    model: 'text-embedding-3-small',
    batchSize: 100,
  },
  triggerConfig: {
    gitHooks: false,
    watchMode: false,
    schedule: null,
  },
};

export class IndexManagementService {
  private status: IndexStatus = {
    status: 'idle',
    lastRun: null,
    filesIndexed: 0,
    chunksCreated: 0,
  };

  private history: IndexHistoryEntry[] = [];
  private config: IndexConfig = { ...DEFAULT_INDEX_CONFIG };
  private indexingTimer: ReturnType<typeof setTimeout> | null = null;

  async getStatus(): Promise<IndexStatus> {
    return { ...this.status };
  }

  async triggerIndex(request?: TriggerIndexRequest): Promise<void> {
    if (this.status.status === 'indexing') {
      throw new Error('Indexing is already in progress');
    }

    this.status = {
      status: 'indexing',
      lastRun: this.status.lastRun,
      filesIndexed: 0,
      chunksCreated: 0,
      progress: 0,
      currentFile: 'Scanning files...',
    };

    // Simulate indexing completion asynchronously
    const startTime = new Date().toISOString();
    this.indexingTimer = setTimeout(() => {
      const filesIndexed = Math.floor(Math.random() * 200) + 50;
      const chunksCreated = filesIndexed * 5 + Math.floor(Math.random() * 100);
      const now = new Date().toISOString();

      this.status = {
        status: 'idle',
        lastRun: now,
        filesIndexed,
        chunksCreated,
        progress: 100,
      };

      this.history.unshift({
        id: randomUUID(),
        startTime,
        endTime: now,
        filesProcessed: filesIndexed,
        chunksCreated,
        chunksUpdated: Math.floor(chunksCreated * 0.1),
        chunksDeleted: Math.floor(Math.random() * 10),
        embeddingCost: chunksCreated * 0.00002,
        durationMs: 3000 + Math.floor(Math.random() * 2000),
        status: 'success',
        errors: [],
      });
    }, 3000);
  }

  async cancelIndex(): Promise<void> {
    if (this.status.status !== 'indexing') {
      throw new Error('No indexing operation in progress');
    }

    if (this.indexingTimer) {
      clearTimeout(this.indexingTimer);
      this.indexingTimer = null;
    }

    this.status = {
      ...this.status,
      status: 'idle',
      progress: undefined,
      currentFile: undefined,
    };
  }

  async getHistory(limit = 20): Promise<IndexHistoryEntry[]> {
    return this.history.slice(0, limit);
  }

  async getConfig(): Promise<IndexConfig> {
    return { ...this.config };
  }

  async updateConfig(config: Partial<IndexConfig>): Promise<IndexConfig> {
    if (config.includePatterns !== undefined) {
      this.config.includePatterns = config.includePatterns;
    }
    if (config.excludePatterns !== undefined) {
      this.config.excludePatterns = config.excludePatterns;
    }
    if (config.chunkingConfig) {
      this.config.chunkingConfig = { ...this.config.chunkingConfig, ...config.chunkingConfig };
    }
    if (config.embeddingConfig) {
      this.config.embeddingConfig = { ...this.config.embeddingConfig, ...config.embeddingConfig };
    }
    if (config.triggerConfig) {
      this.config.triggerConfig = { ...this.config.triggerConfig, ...config.triggerConfig };
    }
    return { ...this.config };
  }

  dispose(): void {
    if (this.indexingTimer) {
      clearTimeout(this.indexingTimer);
      this.indexingTimer = null;
    }
  }
}

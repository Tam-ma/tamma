/**
 * Index Management Service Contract
 *
 * Defines the interface for codebase indexing operations.
 */

import type { IndexStatus, IndexHistoryEntry, IndexConfig } from '../../types/knowledge-base/index-types.js';

export interface IIndexService {
  getStatus(): Promise<IndexStatus>;
  triggerIndex(options?: { fullReindex?: boolean }): Promise<void>;
  cancelIndex(): Promise<void>;
  getHistory(limit?: number): Promise<IndexHistoryEntry[]>;
  getConfig(): Promise<IndexConfig>;
  updateConfig(config: Partial<IndexConfig>): Promise<IndexConfig>;
}

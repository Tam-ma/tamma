/**
 * Budget Manager
 *
 * Manages token budget allocation across context sources.
 * Supports priority-based allocation and task-specific defaults.
 */

import type {
  ContextSourceType,
  TaskType,
  BudgetConfig,
} from './types.js';

/**
 * Task-specific default sources
 */
const DEFAULT_SOURCES_BY_TASK: Record<TaskType, ContextSourceType[]> = {
  analysis: ['vector_db', 'rag'],
  planning: ['vector_db', 'rag', 'mcp'],
  implementation: ['vector_db', 'rag', 'mcp', 'web_search'],
  review: ['vector_db', 'rag'],
  testing: ['vector_db', 'rag'],
  documentation: ['vector_db', 'rag', 'web_search'],
};

/**
 * Task-specific default priorities (higher = more budget allocation)
 */
const DEFAULT_PRIORITIES_BY_TASK: Record<TaskType, Record<ContextSourceType, number>> = {
  analysis: { vector_db: 3, rag: 2, mcp: 1, web_search: 0.5, live_api: 0.5 },
  planning: { vector_db: 2, rag: 3, mcp: 2, web_search: 1, live_api: 0.5 },
  implementation: { vector_db: 4, rag: 2, mcp: 2, web_search: 1, live_api: 0.5 },
  review: { vector_db: 4, rag: 2, mcp: 1, web_search: 0.5, live_api: 0.5 },
  testing: { vector_db: 3, rag: 2, mcp: 1, web_search: 1, live_api: 0.5 },
  documentation: { vector_db: 2, rag: 2, mcp: 1, web_search: 3, live_api: 0.5 },
};

/**
 * Budget allocation result
 */
export interface BudgetAllocation {
  allocations: Record<ContextSourceType, number>;
  effectiveBudget: number;
}

/**
 * Manages token budget allocation across context sources
 */
export class BudgetManager {
  private config: BudgetConfig;

  constructor(config: BudgetConfig) {
    this.config = config;
  }

  /**
   * Allocate token budget across sources based on priorities
   */
  allocateBudget(
    sources: ContextSourceType[],
    priorities: Partial<Record<ContextSourceType, number>>,
    totalBudget: number
  ): Record<ContextSourceType, number> {
    if (sources.length === 0 || totalBudget <= 0) {
      return {} as Record<ContextSourceType, number>;
    }

    const totalPriority = sources.reduce(
      (sum, s) => sum + (priorities[s] ?? 1),
      0
    );

    if (totalPriority === 0) {
      // Equal distribution if all priorities are 0
      const perSource = Math.floor(totalBudget / sources.length);
      return Object.fromEntries(
        sources.map(source => [source, perSource])
      ) as Record<ContextSourceType, number>;
    }

    const allocation = Object.fromEntries(
      sources.map(source => [
        source,
        Math.floor(totalBudget * (priorities[source] ?? 1) / totalPriority),
      ])
    ) as Record<ContextSourceType, number>;

    // Ensure minimum allocation for each source
    for (const source of sources) {
      if (allocation[source] < this.config.minChunkTokens) {
        allocation[source] = this.config.minChunkTokens;
      }
    }

    return allocation;
  }

  /**
   * Calculate effective budget after reserving tokens
   */
  calculateEffectiveBudget(maxTokens: number, reservedTokens?: number): number {
    const reserved = reservedTokens ?? this.config.reservedTokens;
    return Math.max(0, maxTokens - reserved);
  }

  /**
   * Get default sources for a task type
   */
  getDefaultSources(taskType: TaskType): ContextSourceType[] {
    return DEFAULT_SOURCES_BY_TASK[taskType] ?? ['vector_db', 'rag'];
  }

  /**
   * Get default priorities for a task type
   */
  getDefaultPriorities(taskType: TaskType): Record<ContextSourceType, number> {
    return { ...DEFAULT_PRIORITIES_BY_TASK[taskType] };
  }

  /**
   * Reallocate unused budget from failed sources to successful ones
   */
  reallocateUnusedBudget(
    originalAllocation: Record<ContextSourceType, number>,
    usedTokens: Record<ContextSourceType, number>,
    failedSources: ContextSourceType[]
  ): Record<ContextSourceType, number> {
    // Calculate freed budget from failed and underused sources
    let freedBudget = 0;
    const activeSources: ContextSourceType[] = [];

    for (const [source, allocated] of Object.entries(originalAllocation)) {
      const src = source as ContextSourceType;
      if (failedSources.includes(src)) {
        freedBudget += allocated;
      } else {
        const used = usedTokens[src] ?? 0;
        const unused = Math.max(0, allocated - used);
        freedBudget += unused;
        activeSources.push(src);
      }
    }

    if (activeSources.length === 0 || freedBudget <= 0) {
      return { ...originalAllocation };
    }

    // Distribute freed budget proportionally among active sources
    const perSource = Math.floor(freedBudget / activeSources.length);
    const result = { ...originalAllocation };

    for (const source of activeSources) {
      result[source] = (usedTokens[source] ?? 0) + perSource;
    }

    for (const source of failedSources) {
      result[source] = 0;
    }

    return result;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<BudgetConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

/**
 * Create a BudgetManager instance
 */
export function createBudgetManager(config: BudgetConfig): BudgetManager {
  return new BudgetManager(config);
}

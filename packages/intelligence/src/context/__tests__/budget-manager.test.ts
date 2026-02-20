import { describe, it, expect, beforeEach } from 'vitest';
import { BudgetManager, createBudgetManager } from '../budget-manager.js';
import type { BudgetConfig, ContextSourceType, TaskType } from '../types.js';

describe('BudgetManager', () => {
  let manager: BudgetManager;
  const defaultConfig: BudgetConfig = {
    defaultMaxTokens: 8000,
    reservedTokens: 1000,
    minChunkTokens: 50,
    maxChunkTokens: 1000,
  };

  beforeEach(() => {
    manager = new BudgetManager(defaultConfig);
  });

  describe('createBudgetManager', () => {
    it('should create an instance via factory', () => {
      const m = createBudgetManager(defaultConfig);
      expect(m).toBeInstanceOf(BudgetManager);
    });
  });

  describe('calculateEffectiveBudget', () => {
    it('should subtract reserved tokens from max tokens', () => {
      const result = manager.calculateEffectiveBudget(8000);
      expect(result).toBe(7000); // 8000 - 1000 reserved
    });

    it('should use explicit reserved tokens when provided', () => {
      const result = manager.calculateEffectiveBudget(8000, 500);
      expect(result).toBe(7500); // 8000 - 500
    });

    it('should return 0 when reserved >= max', () => {
      const result = manager.calculateEffectiveBudget(500, 1000);
      expect(result).toBe(0);
    });

    it('should never return negative', () => {
      const result = manager.calculateEffectiveBudget(100, 5000);
      expect(result).toBe(0);
    });
  });

  describe('allocateBudget', () => {
    it('should allocate proportionally by priority', () => {
      const sources: ContextSourceType[] = ['vector_db', 'rag'];
      const priorities = { vector_db: 3, rag: 1 };
      const allocation = manager.allocateBudget(sources, priorities, 4000);

      expect(allocation.vector_db).toBe(3000); // 3/4 of 4000
      expect(allocation.rag).toBe(1000); // 1/4 of 4000
    });

    it('should handle empty sources', () => {
      const allocation = manager.allocateBudget([], {}, 4000);
      expect(Object.keys(allocation)).toHaveLength(0);
    });

    it('should handle zero budget', () => {
      const allocation = manager.allocateBudget(['vector_db'], { vector_db: 1 }, 0);
      expect(Object.keys(allocation)).toHaveLength(0);
    });

    it('should use default priority of 1 for missing entries', () => {
      const sources: ContextSourceType[] = ['vector_db', 'rag'];
      const priorities = { vector_db: 1 };
      const allocation = manager.allocateBudget(sources, priorities, 2000);

      expect(allocation.vector_db).toBe(1000);
      expect(allocation.rag).toBe(1000);
    });

    it('should distribute equally when all priorities are 0', () => {
      const sources: ContextSourceType[] = ['vector_db', 'rag'];
      const priorities = { vector_db: 0, rag: 0 };
      const allocation = manager.allocateBudget(sources, priorities, 2000);

      expect(allocation.vector_db).toBe(1000);
      expect(allocation.rag).toBe(1000);
    });

    it('should enforce minimum allocation per source', () => {
      const sources: ContextSourceType[] = ['vector_db', 'rag', 'mcp'];
      const priorities = { vector_db: 100, rag: 1, mcp: 1 };
      const allocation = manager.allocateBudget(sources, priorities, 200);

      // Even low-priority sources get at least minChunkTokens (50)
      expect(allocation.rag).toBeGreaterThanOrEqual(50);
      expect(allocation.mcp).toBeGreaterThanOrEqual(50);
    });
  });

  describe('getDefaultSources', () => {
    it('should return correct sources for analysis', () => {
      const sources = manager.getDefaultSources('analysis');
      expect(sources).toContain('vector_db');
      expect(sources).toContain('rag');
    });

    it('should return correct sources for implementation', () => {
      const sources = manager.getDefaultSources('implementation');
      expect(sources).toContain('vector_db');
      expect(sources).toContain('rag');
      expect(sources).toContain('mcp');
      expect(sources).toContain('web_search');
    });

    it('should fall back to vector_db and rag for unknown task types', () => {
      const sources = manager.getDefaultSources('unknown' as TaskType);
      expect(sources).toEqual(['vector_db', 'rag']);
    });
  });

  describe('getDefaultPriorities', () => {
    it('should return priorities for analysis', () => {
      const priorities = manager.getDefaultPriorities('analysis');
      expect(priorities.vector_db).toBeDefined();
      expect(priorities.rag).toBeDefined();
    });

    it('should return a copy (not reference)', () => {
      const p1 = manager.getDefaultPriorities('analysis');
      const p2 = manager.getDefaultPriorities('analysis');
      p1.vector_db = 999;
      expect(p2.vector_db).not.toBe(999);
    });
  });

  describe('reallocateUnusedBudget', () => {
    it('should redistribute budget from failed sources', () => {
      const original = { vector_db: 2000, rag: 2000, mcp: 1000 } as Record<ContextSourceType, number>;
      const used = { vector_db: 1500, rag: 1000 } as Record<ContextSourceType, number>;
      const failed: ContextSourceType[] = ['mcp'];

      const result = manager.reallocateUnusedBudget(original, used, failed);

      expect(result.mcp).toBe(0);
      expect(result.vector_db).toBeGreaterThan(0);
      expect(result.rag).toBeGreaterThan(0);
    });

    it('should handle all sources failed', () => {
      const original = { vector_db: 2000, rag: 2000 } as Record<ContextSourceType, number>;
      const used = {} as Record<ContextSourceType, number>;
      const failed: ContextSourceType[] = ['vector_db', 'rag'];

      const result = manager.reallocateUnusedBudget(original, used, failed);
      expect(result).toEqual(original);
    });
  });

  describe('updateConfig', () => {
    it('should update partial config', () => {
      manager.updateConfig({ minChunkTokens: 100 });
      // Verify by testing that min allocation is now 100
      const sources: ContextSourceType[] = ['vector_db', 'rag'];
      const priorities = { vector_db: 100, rag: 1 };
      const allocation = manager.allocateBudget(sources, priorities, 200);
      expect(allocation.rag).toBeGreaterThanOrEqual(100);
    });
  });
});

/**
 * Cache unit tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { CapabilityCache, type CachedCapabilities } from '../../src/cache/capability-cache.js';
import { ResourceCache } from '../../src/cache/resource-cache.js';

describe('CapabilityCache', () => {
  let cache: CapabilityCache;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new CapabilityCache({ ttlMs: 60000 }); // 1 minute TTL
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const sampleCapabilities: CachedCapabilities = {
    capabilities: {
      tools: { listChanged: true },
      resources: { subscribe: false },
    },
    tools: [
      { name: 'tool1', description: 'Test tool', inputSchema: {}, serverName: 'server1' },
    ],
    resources: [
      { uri: 'file:///test.txt', name: 'test.txt', serverName: 'server1' },
    ],
    prompts: [],
    cachedAt: Date.now(),
  };

  describe('set and get', () => {
    it('should store and retrieve capabilities', () => {
      cache.set('server1', sampleCapabilities);

      const retrieved = cache.get('server1');

      expect(retrieved?.capabilities).toEqual(sampleCapabilities.capabilities);
      expect(retrieved?.tools).toEqual(sampleCapabilities.tools);
    });

    it('should return undefined for non-existent server', () => {
      const retrieved = cache.get('nonexistent');

      expect(retrieved).toBeUndefined();
    });

    it('should return undefined for expired entry', () => {
      cache.set('server1', sampleCapabilities);

      // Advance time past TTL
      vi.advanceTimersByTime(61000);

      const retrieved = cache.get('server1');

      expect(retrieved).toBeUndefined();
    });
  });

  describe('has', () => {
    it('should return true for cached server', () => {
      cache.set('server1', sampleCapabilities);

      expect(cache.has('server1')).toBe(true);
    });

    it('should return false for non-existent server', () => {
      expect(cache.has('nonexistent')).toBe(false);
    });

    it('should return false for expired entry', () => {
      cache.set('server1', sampleCapabilities);

      vi.advanceTimersByTime(61000);

      expect(cache.has('server1')).toBe(false);
    });
  });

  describe('invalidate', () => {
    it('should remove a server from cache', () => {
      cache.set('server1', sampleCapabilities);

      cache.invalidate('server1');

      expect(cache.has('server1')).toBe(false);
    });

    it('should not throw for non-existent server', () => {
      expect(() => cache.invalidate('nonexistent')).not.toThrow();
    });
  });

  describe('invalidateAll', () => {
    it('should remove all servers from cache', () => {
      cache.set('server1', sampleCapabilities);
      cache.set('server2', { ...sampleCapabilities, tools: [] });

      cache.invalidateAll();

      expect(cache.has('server1')).toBe(false);
      expect(cache.has('server2')).toBe(false);
    });
  });

  describe('getTools', () => {
    it('should return tools for a server', () => {
      cache.set('server1', sampleCapabilities);

      const tools = cache.getTools('server1');

      expect(tools).toEqual(sampleCapabilities.tools);
    });

    it('should return undefined for non-existent server', () => {
      const tools = cache.getTools('nonexistent');

      expect(tools).toBeUndefined();
    });
  });

  describe('getResources', () => {
    it('should return resources for a server', () => {
      cache.set('server1', sampleCapabilities);

      const resources = cache.getResources('server1');

      expect(resources).toEqual(sampleCapabilities.resources);
    });
  });

  describe('updateTools', () => {
    it('should update tools for a server', () => {
      cache.set('server1', sampleCapabilities);

      const newTools = [
        { name: 'tool2', description: 'New tool', inputSchema: {}, serverName: 'server1' },
      ];

      cache.updateTools('server1', newTools);

      expect(cache.getTools('server1')).toEqual(newTools);
    });

    it('should not throw for non-existent server', () => {
      expect(() => cache.updateTools('nonexistent', [])).not.toThrow();
    });
  });

  describe('getStats', () => {
    it('should return cache statistics', () => {
      cache.set('server1', sampleCapabilities);

      const stats = cache.getStats();

      expect(stats.serverCount).toBe(1);
      expect(stats.totalTools).toBe(1);
      expect(stats.totalResources).toBe(1);
      expect(stats.totalPrompts).toBe(0);
    });
  });
});

describe('ResourceCache', () => {
  let cache: ResourceCache;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new ResourceCache({
      ttlMs: 60000, // 1 minute TTL
      maxSizeBytes: 1024, // 1KB max
      maxEntries: 10,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('set and get', () => {
    it('should store and retrieve resource content', () => {
      const content = {
        uri: 'file:///test.txt',
        mimeType: 'text/plain',
        text: 'Hello, World!',
      };

      cache.set('server1', content);

      const retrieved = cache.get('server1', content.uri);

      expect(retrieved).toEqual(content);
    });

    it('should return undefined for non-existent resource', () => {
      const retrieved = cache.get('server1', 'file:///nonexistent.txt');

      expect(retrieved).toBeUndefined();
    });

    it('should return undefined for expired entry', () => {
      const content = {
        uri: 'file:///test.txt',
        text: 'Hello',
      };

      cache.set('server1', content);

      vi.advanceTimersByTime(61000);

      const retrieved = cache.get('server1', content.uri);

      expect(retrieved).toBeUndefined();
    });
  });

  describe('has', () => {
    it('should return true for cached resource', () => {
      cache.set('server1', { uri: 'file:///test.txt', text: 'Hello' });

      expect(cache.has('server1', 'file:///test.txt')).toBe(true);
    });

    it('should return false for non-existent resource', () => {
      expect(cache.has('server1', 'file:///nonexistent.txt')).toBe(false);
    });
  });

  describe('delete', () => {
    it('should remove a resource from cache', () => {
      cache.set('server1', { uri: 'file:///test.txt', text: 'Hello' });

      const result = cache.delete('server1', 'file:///test.txt');

      expect(result).toBe(true);
      expect(cache.has('server1', 'file:///test.txt')).toBe(false);
    });

    it('should return false for non-existent resource', () => {
      const result = cache.delete('server1', 'file:///nonexistent.txt');

      expect(result).toBe(false);
    });
  });

  describe('clearServer', () => {
    it('should remove all resources for a server', () => {
      cache.set('server1', { uri: 'file:///test1.txt', text: 'Hello' });
      cache.set('server1', { uri: 'file:///test2.txt', text: 'World' });
      cache.set('server2', { uri: 'file:///test3.txt', text: 'Other' });

      cache.clearServer('server1');

      expect(cache.has('server1', 'file:///test1.txt')).toBe(false);
      expect(cache.has('server1', 'file:///test2.txt')).toBe(false);
      expect(cache.has('server2', 'file:///test3.txt')).toBe(true);
    });
  });

  describe('clear', () => {
    it('should remove all resources', () => {
      cache.set('server1', { uri: 'file:///test1.txt', text: 'Hello' });
      cache.set('server2', { uri: 'file:///test2.txt', text: 'World' });

      cache.clear();

      const stats = cache.getStats();
      expect(stats.entryCount).toBe(0);
      expect(stats.totalSize).toBe(0);
    });
  });

  describe('size limits', () => {
    it('should not cache content larger than max size', () => {
      const largeContent = {
        uri: 'file:///large.txt',
        text: 'x'.repeat(2000), // Larger than 1KB max
      };

      cache.set('server1', largeContent);

      expect(cache.has('server1', largeContent.uri)).toBe(false);
    });

    it('should evict old entries when size limit reached', () => {
      // Fill cache with small entries
      for (let i = 0; i < 5; i++) {
        cache.set('server1', {
          uri: `file:///test${i}.txt`,
          text: 'x'.repeat(100), // ~200 bytes per entry
        });
      }

      // Add one more that should trigger eviction
      cache.set('server1', {
        uri: 'file:///new.txt',
        text: 'y'.repeat(500),
      });

      // Oldest entries should be evicted
      const stats = cache.getStats();
      expect(stats.totalSize).toBeLessThanOrEqual(1024);
    });

    it('should evict when max entries reached', () => {
      const cache = new ResourceCache({ maxEntries: 3 });

      cache.set('server1', { uri: 'file:///1.txt', text: 'a' });
      cache.set('server1', { uri: 'file:///2.txt', text: 'b' });
      cache.set('server1', { uri: 'file:///3.txt', text: 'c' });
      cache.set('server1', { uri: 'file:///4.txt', text: 'd' });

      const stats = cache.getStats();
      expect(stats.entryCount).toBeLessThanOrEqual(3);
    });
  });

  describe('LRU behavior', () => {
    it('should move accessed items to end', () => {
      const cache = new ResourceCache({ maxEntries: 3 });

      cache.set('server1', { uri: 'file:///1.txt', text: 'a' });
      cache.set('server1', { uri: 'file:///2.txt', text: 'b' });
      cache.set('server1', { uri: 'file:///3.txt', text: 'c' });

      // Access first item (moves to end)
      cache.get('server1', 'file:///1.txt');

      // Add new item (should evict item 2, not 1)
      cache.set('server1', { uri: 'file:///4.txt', text: 'd' });

      expect(cache.has('server1', 'file:///1.txt')).toBe(true);
      expect(cache.has('server1', 'file:///2.txt')).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return cache statistics', () => {
      cache.set('server1', { uri: 'file:///test.txt', text: 'Hello' });

      const stats = cache.getStats();

      expect(stats.entryCount).toBe(1);
      expect(stats.totalSize).toBeGreaterThan(0);
      expect(stats.maxSize).toBe(1024);
      expect(stats.utilization).toBeGreaterThan(0);
      expect(stats.utilization).toBeLessThanOrEqual(1);
    });
  });
});

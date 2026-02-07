/**
 * Pagination tests
 */

import { describe, it, expect, vi } from 'vitest';
import {
  paginateArray,
  ResourcePaginator,
  PaginatedIterator,
  offsetToCursor,
  cursorToOffset,
  DEFAULT_PAGE_SIZE,
  type PaginatedResult,
} from '../../src/pagination.js';
import type { MCPResource, ResourceContent } from '../../src/types.js';

describe('paginateArray', () => {
  const items = Array.from({ length: 100 }, (_, i) => ({ id: i }));

  it('should return first page with default page size', () => {
    const result = paginateArray(items);

    expect(result.items).toHaveLength(DEFAULT_PAGE_SIZE);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe(String(DEFAULT_PAGE_SIZE));
    expect(result.totalCount).toBe(100);
  });

  it('should respect custom page size', () => {
    const result = paginateArray(items, { pageSize: 10 });

    expect(result.items).toHaveLength(10);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe('10');
  });

  it('should use cursor for offset', () => {
    const result = paginateArray(items, { pageSize: 10, cursor: '20' });

    expect(result.items).toHaveLength(10);
    expect(result.items[0]).toEqual({ id: 20 });
    expect(result.nextCursor).toBe('30');
  });

  it('should handle last page', () => {
    const result = paginateArray(items, { pageSize: 10, cursor: '95' });

    expect(result.items).toHaveLength(5);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeUndefined();
  });

  it('should handle empty array', () => {
    const result = paginateArray([]);

    expect(result.items).toHaveLength(0);
    expect(result.hasMore).toBe(false);
    expect(result.totalCount).toBe(0);
  });

  it('should handle array smaller than page size', () => {
    const result = paginateArray([1, 2, 3], { pageSize: 10 });

    expect(result.items).toEqual([1, 2, 3]);
    expect(result.hasMore).toBe(false);
  });
});

describe('ResourcePaginator', () => {
  describe('paginateText', () => {
    it('should paginate text content', () => {
      const paginator = new ResourcePaginator(10); // 10 byte chunks
      const text = 'Hello World, this is a test message';

      const chunks = Array.from(paginator.paginateText('file:///test.txt', text, 'text/plain'));

      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[0]?.startOffset).toBe(0);
      expect(chunks[0]?.text).toBe('Hello Worl');
      expect(chunks[chunks.length - 1]?.isLastChunk).toBe(true);

      // Verify all text is covered
      const reconstructed = chunks.map((c) => c.text).join('');
      expect(reconstructed).toBe(text);
    });

    it('should handle empty text', () => {
      const paginator = new ResourcePaginator(10);
      const chunks = Array.from(paginator.paginateText('file:///test.txt', ''));

      expect(chunks).toHaveLength(1);
      expect(chunks[0]?.text).toBe('');
      expect(chunks[0]?.isLastChunk).toBe(true);
    });

    it('should handle text smaller than chunk size', () => {
      const paginator = new ResourcePaginator(100);
      const chunks = Array.from(paginator.paginateText('file:///test.txt', 'Hello'));

      expect(chunks).toHaveLength(1);
      expect(chunks[0]?.text).toBe('Hello');
      expect(chunks[0]?.isLastChunk).toBe(true);
    });
  });

  describe('paginateBlob', () => {
    it('should paginate binary content', () => {
      const paginator = new ResourcePaginator(10); // 10 byte chunks
      const blob = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);

      const chunks = Array.from(paginator.paginateBlob('file:///data.bin', blob, 'application/octet-stream'));

      expect(chunks).toHaveLength(2);
      expect(chunks[0]?.blob?.length).toBe(10);
      expect(chunks[1]?.blob?.length).toBe(5);
      expect(chunks[1]?.isLastChunk).toBe(true);
    });

    it('should handle empty blob', () => {
      const paginator = new ResourcePaginator(10);
      const chunks = Array.from(paginator.paginateBlob('file:///data.bin', new Uint8Array(0)));

      expect(chunks).toHaveLength(1);
      expect(chunks[0]?.blob?.length).toBe(0);
      expect(chunks[0]?.isLastChunk).toBe(true);
    });
  });

  describe('paginateContent', () => {
    it('should paginate text content', () => {
      const paginator = new ResourcePaginator(5);
      const content: ResourceContent = {
        uri: 'file:///test.txt',
        mimeType: 'text/plain',
        text: 'Hello World',
      };

      const chunks = Array.from(paginator.paginateContent(content));

      expect(chunks.length).toBeGreaterThan(1);
      const reconstructed = chunks.map((c) => c.text).join('');
      expect(reconstructed).toBe('Hello World');
    });

    it('should paginate blob content', () => {
      const paginator = new ResourcePaginator(5);
      const content: ResourceContent = {
        uri: 'file:///data.bin',
        blob: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
      };

      const chunks = Array.from(paginator.paginateContent(content));

      expect(chunks).toHaveLength(2);
    });

    it('should handle empty content', () => {
      const paginator = new ResourcePaginator(10);
      const content: ResourceContent = {
        uri: 'file:///empty.txt',
      };

      const chunks = Array.from(paginator.paginateContent(content));

      expect(chunks).toHaveLength(1);
      expect(chunks[0]?.isLastChunk).toBe(true);
    });
  });
});

describe('PaginatedIterator', () => {
  it('should iterate through all pages', async () => {
    const allItems = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    let fetchCount = 0;

    const fetcher = async (cursor?: string): Promise<PaginatedResult<number>> => {
      fetchCount++;
      const offset = cursor ? parseInt(cursor, 10) : 0;
      const items = allItems.slice(offset, offset + 3);
      const hasMore = offset + 3 < allItems.length;
      return {
        items,
        hasMore,
        nextCursor: hasMore ? String(offset + 3) : undefined,
        totalCount: allItems.length,
      };
    };

    const iterator = new PaginatedIterator(fetcher);
    const collected: number[] = [];

    for await (const item of iterator) {
      collected.push(item);
    }

    expect(collected).toEqual(allItems);
    expect(fetchCount).toBe(4); // 3 + 3 + 3 + 1
  });

  it('should support toArray', async () => {
    const fetcher = async (): Promise<PaginatedResult<string>> => ({
      items: ['a', 'b', 'c'],
      hasMore: false,
    });

    const iterator = new PaginatedIterator(fetcher);
    const result = await iterator.toArray();

    expect(result).toEqual(['a', 'b', 'c']);
  });

  it('should support nextPage', async () => {
    let page = 0;
    const fetcher = async (): Promise<PaginatedResult<number>> => {
      page++;
      return {
        items: [page * 10],
        hasMore: page < 3,
        nextCursor: page < 3 ? String(page) : undefined,
      };
    };

    const iterator = new PaginatedIterator(fetcher);

    const page1 = await iterator.nextPage();
    expect(page1?.items).toEqual([10]);
    expect(iterator.hasMore()).toBe(true);

    const page2 = await iterator.nextPage();
    expect(page2?.items).toEqual([20]);

    const page3 = await iterator.nextPage();
    expect(page3?.items).toEqual([30]);

    const page4 = await iterator.nextPage();
    expect(page4).toBeUndefined();
  });

  it('should handle empty results', async () => {
    const fetcher = async (): Promise<PaginatedResult<number>> => ({
      items: [],
      hasMore: false,
    });

    const iterator = new PaginatedIterator(fetcher);
    const result = await iterator.toArray();

    expect(result).toEqual([]);
  });
});

describe('cursor utilities', () => {
  describe('offsetToCursor', () => {
    it('should encode offset to base64', () => {
      const cursor = offsetToCursor(100);
      expect(cursor).toBe(Buffer.from('100').toString('base64'));
    });
  });

  describe('cursorToOffset', () => {
    it('should decode cursor to offset', () => {
      const cursor = offsetToCursor(42);
      const offset = cursorToOffset(cursor);
      expect(offset).toBe(42);
    });

    it('should return 0 for invalid cursor', () => {
      expect(cursorToOffset('invalid')).toBe(0);
      expect(cursorToOffset('')).toBe(0);
    });
  });

  it('should roundtrip correctly', () => {
    const original = 12345;
    const cursor = offsetToCursor(original);
    const decoded = cursorToOffset(cursor);
    expect(decoded).toBe(original);
  });
});

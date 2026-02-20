/**
 * @tamma/mcp-client
 * Resource pagination support
 */

import type { MCPResource, ResourceContent } from './types.js';

/**
 * Pagination options
 */
export interface PaginationOptions {
  /** Maximum items per page (default: 50) */
  pageSize?: number;
  /** Cursor for the next page */
  cursor?: string;
}

/**
 * Paginated result
 */
export interface PaginatedResult<T> {
  /** Items in the current page */
  items: T[];
  /** Cursor for the next page (undefined if no more pages) */
  nextCursor?: string;
  /** Total count (if available) */
  totalCount?: number;
  /** Whether there are more pages */
  hasMore: boolean;
}

/**
 * Default page size
 */
export const DEFAULT_PAGE_SIZE = 50;

/**
 * Paginated resource list
 */
export interface PaginatedResourceList extends PaginatedResult<MCPResource> {}

/**
 * Paginated resource content (for large resources)
 */
export interface PaginatedResourceContent {
  /** Resource URI */
  uri: string;
  /** MIME type */
  mimeType?: string;
  /** Content chunk */
  text?: string;
  /** Binary content chunk */
  blob?: Uint8Array;
  /** Start byte offset */
  startOffset: number;
  /** End byte offset */
  endOffset: number;
  /** Total size (if known) */
  totalSize?: number;
  /** Is this the last chunk */
  isLastChunk: boolean;
}

/**
 * Create a paginated result from an array
 */
export function paginateArray<T>(
  items: T[],
  options: PaginationOptions = {}
): PaginatedResult<T> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const startIndex = options.cursor ? parseInt(options.cursor, 10) : 0;

  const pageItems = items.slice(startIndex, startIndex + pageSize);
  const hasMore = startIndex + pageSize < items.length;
  const nextCursor = hasMore ? String(startIndex + pageSize) : undefined;

  return {
    items: pageItems,
    nextCursor,
    totalCount: items.length,
    hasMore,
  };
}

/**
 * Resource paginator for paginating large resource content
 */
export class ResourcePaginator {
  private readonly chunkSize: number;

  constructor(chunkSize = 64 * 1024) {
    // Default 64KB chunks
    this.chunkSize = chunkSize;
  }

  /**
   * Paginate text content
   */
  *paginateText(
    uri: string,
    text: string,
    mimeType?: string
  ): Generator<PaginatedResourceContent> {
    const totalSize = text.length;
    let offset = 0;

    while (offset < totalSize) {
      const chunk = text.slice(offset, offset + this.chunkSize);
      const endOffset = offset + chunk.length;

      yield {
        uri,
        mimeType,
        text: chunk,
        startOffset: offset,
        endOffset,
        totalSize,
        isLastChunk: endOffset >= totalSize,
      };

      offset = endOffset;
    }

    // Handle empty content
    if (totalSize === 0) {
      yield {
        uri,
        mimeType,
        text: '',
        startOffset: 0,
        endOffset: 0,
        totalSize: 0,
        isLastChunk: true,
      };
    }
  }

  /**
   * Paginate binary content
   */
  *paginateBlob(
    uri: string,
    blob: Uint8Array,
    mimeType?: string
  ): Generator<PaginatedResourceContent> {
    const totalSize = blob.length;
    let offset = 0;

    while (offset < totalSize) {
      const chunk = blob.slice(offset, offset + this.chunkSize);
      const endOffset = offset + chunk.length;

      yield {
        uri,
        mimeType,
        blob: chunk,
        startOffset: offset,
        endOffset,
        totalSize,
        isLastChunk: endOffset >= totalSize,
      };

      offset = endOffset;
    }

    // Handle empty content
    if (totalSize === 0) {
      yield {
        uri,
        mimeType,
        blob: new Uint8Array(0),
        startOffset: 0,
        endOffset: 0,
        totalSize: 0,
        isLastChunk: true,
      };
    }
  }

  /**
   * Paginate resource content
   */
  *paginateContent(
    content: ResourceContent
  ): Generator<PaginatedResourceContent> {
    if (content.text) {
      yield* this.paginateText(content.uri, content.text, content.mimeType);
    } else if (content.blob) {
      yield* this.paginateBlob(content.uri, content.blob, content.mimeType);
    } else {
      // Empty content
      yield {
        uri: content.uri,
        mimeType: content.mimeType,
        startOffset: 0,
        endOffset: 0,
        totalSize: 0,
        isLastChunk: true,
      };
    }
  }
}

/**
 * Async iterator for paginated results
 */
export class PaginatedIterator<T> implements AsyncIterable<T> {
  private currentCursor?: string;
  private hasMorePages = true;

  constructor(
    private readonly fetcher: (cursor?: string) => Promise<PaginatedResult<T>>,
    initialCursor?: string
  ) {
    this.currentCursor = initialCursor;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (this.hasMorePages) {
      const result = await this.fetcher(this.currentCursor);

      for (const item of result.items) {
        yield item;
      }

      this.hasMorePages = result.hasMore;
      this.currentCursor = result.nextCursor;
    }
  }

  /**
   * Collect all items into an array
   */
  async toArray(): Promise<T[]> {
    const items: T[] = [];
    for await (const item of this) {
      items.push(item);
    }
    return items;
  }

  /**
   * Get the next page
   */
  async nextPage(): Promise<PaginatedResult<T> | undefined> {
    if (!this.hasMorePages) {
      return undefined;
    }

    const result = await this.fetcher(this.currentCursor);
    this.hasMorePages = result.hasMore;
    this.currentCursor = result.nextCursor;

    return result;
  }

  /**
   * Check if there are more pages
   */
  hasMore(): boolean {
    return this.hasMorePages;
  }
}

/**
 * Create a cursor from an offset
 */
export function offsetToCursor(offset: number): string {
  return Buffer.from(String(offset)).toString('base64');
}

/**
 * Parse a cursor to an offset
 */
export function cursorToOffset(cursor: string): number {
  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
    const offset = parseInt(decoded, 10);
    return Number.isNaN(offset) ? 0 : offset;
  } catch {
    return 0;
  }
}

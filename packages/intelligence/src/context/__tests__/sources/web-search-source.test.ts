import { describe, it, expect } from 'vitest';
import { WebSearchSource, createWebSearchSource } from '../../sources/web-search-source.js';
import type { SourceQuery } from '../../types.js';

describe('WebSearchSource', () => {
  const source = createWebSearchSource();

  it('should have name web_search', () => {
    expect(source.name).toBe('web_search');
  });

  it('should return empty results (placeholder)', async () => {
    const query: SourceQuery = { text: 'test', maxChunks: 5, maxTokens: 1000 };
    const result = await source.retrieve(query);
    expect(result.chunks).toHaveLength(0);
  });

  it('should be an instance of WebSearchSource', () => {
    expect(createWebSearchSource()).toBeInstanceOf(WebSearchSource);
  });
});

import type { ContextSourceType, SourceQuery, ContextChunk } from '../types.js';
import { BaseContextSource } from './base-source.js';

/**
 * Web search context source.
 * This is a placeholder implementation that can be extended
 * with an actual web search provider (e.g. Serper, Tavily).
 */
export class WebSearchSource extends BaseContextSource {
  readonly name: ContextSourceType = 'web_search';

  protected async doRetrieve(_query: SourceQuery): Promise<ContextChunk[]> {
    // Placeholder: Integrate with web search API
    // E.g. Serper API, Tavily API, Brave Search API
    return [];
  }
}

export function createWebSearchSource(): WebSearchSource {
  return new WebSearchSource();
}

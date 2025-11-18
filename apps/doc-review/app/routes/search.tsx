import { useState, useEffect } from 'react';
import { useLoaderData, useSearchParams, Link } from 'react-router';
import type { LoaderFunctionArgs } from 'react-router';
import { getDb, hasDatabase } from '../lib/db/client.server';
import { SearchQueryBuilder } from '../lib/search/query-builder.server';
import { Search } from 'lucide-react';

/**
 * Search Results Page
 * /search?q=keyword&type=comments&status=open&userId=user-123&docPath=/docs/foo.md
 */

interface SearchResult {
  id: string;
  type: 'document' | 'comment' | 'suggestion' | 'discussion' | 'message';
  docPath: string;
  title?: string;
  content: string;
  snippet?: string;
  authorName?: string;
  authorId?: string;
  status?: string;
  createdAt?: number;
  score: number;
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = (context?.env ?? context?.cloudflare?.env ?? {}) as { DB?: D1Database };
  const url = new URL(request.url);

  // Extract query parameters
  const query = url.searchParams.get('q') || '';
  const type = url.searchParams.get('type');
  const docPath = url.searchParams.get('docPath');
  const userId = url.searchParams.get('userId');
  const status = url.searchParams.get('status');
  const before = url.searchParams.get('before');
  const after = url.searchParams.get('after');
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const limit = 20;
  const offset = (page - 1) * limit;

  // If database not available, return empty results with a message
  if (!hasDatabase(env)) {
    return {
      results: [],
      total: 0,
      facets: { types: {}, statuses: {}, authors: [] },
      query,
      filters: {},
      pagination: {
        limit,
        offset: 0,
        totalPages: 0,
        currentPage: 1
      },
      dbUnavailable: true
    };
  }

  const db = getDb(env);

  // If no query, return empty results
  if (!query || query.length < 2) {
    return {
      results: [],
      total: 0,
      facets: { types: {}, statuses: {}, authors: [] },
      query,
      filters: {},
      pagination: {
        limit,
        offset: 0,
        totalPages: 0,
        currentPage: 1
      }
    };
  }

  try {
    // Build and execute search query
    const builder = new SearchQueryBuilder(db);
    builder.search(query);

    // Apply filters
    if (type) builder.filterByType(type as any);
    if (docPath) builder.filterByDocPath(docPath);
    if (userId) builder.filterByUser(userId);
    if (status) builder.filterByStatus(status);
    if (before || after) builder.filterByDateRange(before || undefined, after || undefined);

    // Apply pagination
    builder.paginate(limit, offset);

    // Execute search
    const searchResults = await builder.execute();

    const totalPages = Math.ceil(searchResults.total / limit);

    return {
      results: searchResults.results,
      total: searchResults.total,
      facets: searchResults.facets,
      query,
      filters: {
        type: type || undefined,
        status: status || undefined,
        userId: userId || undefined,
        docPath: docPath || undefined,
        before: before || undefined,
        after: after || undefined
      },
      pagination: {
        limit,
        offset,
        totalPages,
        currentPage: page
      }
    };
  } catch (error) {
    console.error('Search failed:', error);
    throw new Response('Search failed', { status: 500 });
  }
}

export default function SearchPage() {
  const data = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(data.query);
  const [selectedFilters, setSelectedFilters] = useState(data.filters);

  // Update selected filters when data changes
  useEffect(() => {
    setSelectedFilters(data.filters);
  }, [data.filters]);

  // Update search query when data changes
  useEffect(() => {
    setSearchQuery(data.query);
  }, [data.query]);

  const handleSearch = (e?: React.FormEvent) => {
    e?.preventDefault();
    const newParams = new URLSearchParams(searchParams);
    newParams.set('q', searchQuery);
    newParams.set('page', '1');
    setSearchParams(newParams);
  };

  const handleFilterChange = (filterType: string, value: string | undefined) => {
    const newParams = new URLSearchParams(searchParams);

    if (value) {
      newParams.set(filterType, value);
    } else {
      newParams.delete(filterType);
    }

    // Reset to page 1 when filters change
    newParams.set('page', '1');

    setSearchParams(newParams);
  };

  const clearAllFilters = () => {
    const newParams = new URLSearchParams();
    newParams.set('q', data.query);
    setSearchParams(newParams);
  };

  const getTypeIcon = (type: SearchResult['type']) => {
    switch (type) {
      case 'document':
        return '📄';
      case 'comment':
        return '💬';
      case 'suggestion':
        return '✏️';
      case 'discussion':
        return '🗣️';
      case 'message':
        return '📨';
      default:
        return '🔍';
    }
  };

  const getStatusBadge = (status?: string) => {
    if (!status) return null;

    const statusColors = {
      open: 'bg-green-100 text-green-800',
      pending: 'bg-yellow-100 text-yellow-800',
      resolved: 'bg-blue-100 text-blue-800',
      closed: 'bg-gray-100 text-gray-800',
      approved: 'bg-green-100 text-green-800',
      rejected: 'bg-red-100 text-red-800'
    };

    return (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
          statusColors[status as keyof typeof statusColors] || 'bg-gray-100 text-gray-800'
        }`}
      >
        {status}
      </span>
    );
  };

  const formatDate = (timestamp?: number) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
    if (days < 365) return `${Math.floor(days / 30)} months ago`;
    return `${Math.floor(days / 365)} years ago`;
  };

  const highlightText = (text: string, snippet?: string) => {
    if (!snippet) return text;

    // Replace highlight markers with HTML
    return snippet.replace(/\[([^\]]+)\]/g, '<mark class="bg-yellow-200">$1</mark>');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Search Header */}
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center space-x-4">
            <Link to="/" className="text-gray-600 hover:text-gray-900">
              ← Back
            </Link>
            <form onSubmit={handleSearch} className="flex-1 flex gap-2">
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search documents, comments, suggestions..."
                  className="w-full px-4 py-2 pl-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  aria-label="Search"
                />
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              </div>
              <button
                type="submit"
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors flex items-center gap-2"
              >
                <Search className="w-4 h-4" />
                Search
              </button>
            </form>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex gap-8">
          {/* Filters Sidebar */}
          <aside className="w-64 flex-shrink-0">
            <div className="sticky top-4">
              <div className="bg-white rounded-lg shadow p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-medium">Filters</h3>
                  {Object.keys(selectedFilters).length > 0 && (
                    <button
                      onClick={clearAllFilters}
                      className="text-sm text-blue-600 hover:text-blue-800"
                    >
                      Clear all
                    </button>
                  )}
                </div>

                {/* Content Type Filter */}
                <div className="mb-6">
                  <label htmlFor="content-type" className="block text-sm font-medium text-gray-700 mb-2">
                    Content Type
                  </label>
                  <select
                    id="content-type"
                    value={selectedFilters.type || ''}
                    onChange={(e) => handleFilterChange('type', e.target.value || undefined)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">All Types</option>
                    <option value="documents">Documents</option>
                    <option value="comments">Comments</option>
                    <option value="suggestions">Suggestions</option>
                    <option value="discussions">Discussions</option>
                    <option value="messages">Messages</option>
                  </select>
                  {Object.keys(data.facets.types).length > 0 && (
                    <div className="mt-2 text-xs text-gray-500">
                      {Object.entries(data.facets.types).map(([type, count]) => (
                        <div key={type}>
                          {type}: {count}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Document Path Filter */}
                <div className="mb-6">
                  <label htmlFor="doc-path" className="block text-sm font-medium text-gray-700 mb-2">
                    Document Path
                  </label>
                  <input
                    id="doc-path"
                    type="text"
                    value={selectedFilters.docPath || ''}
                    onChange={(e) => handleFilterChange('docPath', e.target.value || undefined)}
                    placeholder="e.g., /docs/PRD.md"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                {/* Status Filter */}
                <div className="mb-6">
                  <label htmlFor="status-filter" className="block text-sm font-medium text-gray-700 mb-2">
                    Status
                  </label>
                  <select
                    id="status-filter"
                    value={selectedFilters.status || ''}
                    onChange={(e) => handleFilterChange('status', e.target.value || undefined)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">All Statuses</option>
                    <option value="open">Open</option>
                    <option value="pending">Pending</option>
                    <option value="resolved">Resolved</option>
                    <option value="closed">Closed</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                  </select>
                  {Object.keys(data.facets.statuses).length > 0 && (
                    <div className="mt-2 text-xs text-gray-500">
                      {Object.entries(data.facets.statuses).map(([status, count]) => (
                        <div key={status}>
                          {status}: {count}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Author Filter */}
                {data.facets.authors.length > 0 && (
                  <div className="mb-6">
                    <label htmlFor="author-filter" className="block text-sm font-medium text-gray-700 mb-2">
                      Author
                    </label>
                    <select
                      id="author-filter"
                      value={selectedFilters.userId || ''}
                      onChange={(e) => handleFilterChange('userId', e.target.value || undefined)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="">All Authors</option>
                      {data.facets.authors.map((author) => (
                        <option key={author.id} value={author.id}>
                          {author.name} ({author.count})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Date Range Filter */}
                <div className="mb-6">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Date Range</h4>
                  <div className="space-y-2">
                    <input
                      type="date"
                      placeholder="From"
                      value={selectedFilters.after || ''}
                      onChange={(e) => handleFilterChange('after', e.target.value || undefined)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    />
                    <input
                      type="date"
                      placeholder="To"
                      value={selectedFilters.before || ''}
                      onChange={(e) => handleFilterChange('before', e.target.value || undefined)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    />
                  </div>
                </div>
              </div>
            </div>
          </aside>

          {/* Results */}
          <main className="flex-1">
            {/* Results Header */}
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-gray-900">
                {data.total} results for "{data.query}"
              </h1>
              {Object.keys(selectedFilters).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {Object.entries(selectedFilters).map(([key, value]) => (
                    <span
                      key={key}
                      className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-gray-100 text-gray-700"
                    >
                      {key}: {value}
                      <button
                        onClick={() => handleFilterChange(key, undefined)}
                        className="ml-2 text-gray-500 hover:text-gray-700"
                        aria-label={`Remove ${key} filter`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Results List */}
            {data.results.length > 0 ? (
              <div className="space-y-4" data-testid="search-results">
                {data.results.map((result) => (
                  <div
                    key={`${result.type}-${result.id}`}
                    data-testid="search-result-item"
                    className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow"
                  >
                    <div className="flex items-start space-x-3">
                      <span className="text-2xl" aria-hidden="true">
                        {getTypeIcon(result.type)}
                      </span>
                      <div className="flex-1 min-w-0">
                        {/* Title/Header */}
                        <div className="flex items-center space-x-2 mb-1">
                          <Link
                            to={`/docs/${encodeURIComponent(result.docPath.replace('/docs/', ''))}#${result.id}`}
                            data-testid="result-title"
                            className="text-lg font-medium text-blue-600 hover:text-blue-800 truncate"
                          >
                            {result.title || result.content.substring(0, 100)}
                          </Link>
                          {getStatusBadge(result.status)}
                        </div>

                        {/* Snippet */}
                        {result.snippet && (
                          <p
                            className="text-gray-700 mb-2"
                            dangerouslySetInnerHTML={{
                              __html: highlightText(result.content, result.snippet)
                            }}
                          />
                        )}

                        {/* Metadata */}
                        <div className="flex items-center space-x-4 text-sm text-gray-500">
                          <span>{result.type}</span>
                          {result.authorName && (
                            <span>by {result.authorName}</span>
                          )}
                          <span>{result.docPath}</span>
                          {result.createdAt && (
                            <span>{formatDate(result.createdAt)}</span>
                          )}
                          <span className="text-xs text-gray-400">
                            Score: {result.score.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}

                {/* Pagination */}
                {data.pagination.totalPages > 1 && (
                  <div className="flex justify-center mt-8">
                    <nav className="flex space-x-2" aria-label="Pagination">
                      {data.pagination.currentPage > 1 ? (
                        <Link
                          to={`?${new URLSearchParams({
                            ...Object.fromEntries(searchParams),
                            page: String(data.pagination.currentPage - 1)
                          })}`}
                          role="button"
                          className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
                        >
                          Previous
                        </Link>
                      ) : (
                        <button
                          disabled
                          className="px-4 py-2 border border-gray-300 rounded-md bg-gray-100 text-gray-400 cursor-not-allowed"
                        >
                          Previous
                        </button>
                      )}

                      {Array.from({ length: Math.min(5, data.pagination.totalPages) }, (_, i) => {
                        const page = i + 1;
                        return (
                          <Link
                            key={page}
                            to={`?${new URLSearchParams({
                              ...Object.fromEntries(searchParams),
                              page: String(page)
                            })}`}
                            role="button"
                            className={`px-4 py-2 border rounded-md ${
                              page === data.pagination.currentPage
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'border-gray-300 hover:bg-gray-50'
                            }`}
                          >
                            {page}
                          </Link>
                        );
                      })}

                      {data.pagination.currentPage < data.pagination.totalPages ? (
                        <Link
                          to={`?${new URLSearchParams({
                            ...Object.fromEntries(searchParams),
                            page: String(data.pagination.currentPage + 1)
                          })}`}
                          role="button"
                          className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
                        >
                          Next
                        </Link>
                      ) : (
                        <button
                          disabled
                          className="px-4 py-2 border border-gray-300 rounded-md bg-gray-100 text-gray-400 cursor-not-allowed"
                        >
                          Next
                        </button>
                      )}
                    </nav>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white rounded-lg shadow p-12 text-center" data-testid="no-results">
                <p className="text-gray-500 mb-4">No results found{data.query && ` for "${data.query}"`}</p>
                <p className="text-sm text-gray-400">
                  Try adjusting your search terms or filters
                </p>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
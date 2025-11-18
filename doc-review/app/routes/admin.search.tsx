import { useState } from 'react';
import { useLoaderData, useFetcher, Link } from 'react-router';
import type { LoaderFunctionArgs, ActionFunctionArgs } from 'react-router';
import { data as json } from 'react-router';
import { requireAuth } from '../lib/auth/session.server';
import { getDb } from '../lib/db/client.server';
import { SearchAnalytics } from '../lib/search/analytics.server';
import { SearchIndexer } from '../lib/search/indexer.server';

/**
 * Admin Search Dashboard
 * /admin/search
 *
 * Provides search analytics, performance metrics, and maintenance tools
 */

interface LoaderData {
  metrics: {
    totalSearches: number;
    uniqueUsers: number;
    avgResultCount: number;
    avgResponseTime: number;
    clickThroughRate: number;
    noResultsRate: number;
    topQueries: Array<{ query: string; count: number }>;
    topNoResultsQueries: Array<{ query: string; count: number }>;
    searchesByType: Record<string, number>;
    searchesByHour: Array<{ hour: number; count: number }>;
  };
  popularSearches: Array<{
    query: string;
    searchCount: number;
    avgResultCount: number;
    clickThroughRate: number;
    lastSearchedAt: number;
  }>;
  performanceStats: {
    p50ResponseTime: number;
    p95ResponseTime: number;
    p99ResponseTime: number;
    slowestQueries: Array<{ query: string; responseTime: number }>;
  };
  indexStats: {
    documents: number;
    comments: number;
    suggestions: number;
    discussions: number;
    messages: number;
    totalSize: number;
  };
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  // Require admin authentication
  const user = await requireAuth(request, context);
  if (user.role !== 'admin') {
    throw new Response('Forbidden', { status: 403 });
  }

  const env = context.env as { DB: D1Database };
  const db = getDb(env);
  const analytics = new SearchAnalytics(db);
  const indexer = new SearchIndexer(db);

  // Get time range from query params (default to last 30 days)
  const url = new URL(request.url);
  const days = parseInt(url.searchParams.get('days') || '30', 10);
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const endDate = new Date();

  try {
    // Fetch all analytics data
    const [metrics, popularSearches, performanceStats, indexStats] = await Promise.all([
      analytics.getMetrics({ startDate, endDate, limit: 10 }),
      analytics.getPopularSearches(20),
      analytics.getPerformanceStats(),
      indexer.getIndexStats()
    ]);

    return json<LoaderData>({
      metrics,
      popularSearches,
      performanceStats,
      indexStats
    });
  } catch (error) {
    console.error('Failed to load search analytics:', error);
    throw new Response('Failed to load analytics', { status: 500 });
  }
}

export async function action({ request, context }: ActionFunctionArgs) {
  // Require admin authentication
  const user = await requireAuth(request, context);
  if (user.role !== 'admin') {
    throw new Response('Forbidden', { status: 403 });
  }

  const env = context.env as { DB: D1Database };
  const db = getDb(env);
  const formData = await request.formData();
  const action = formData.get('action');

  try {
    switch (action) {
      case 'reindex': {
        const indexer = new SearchIndexer(db);
        const counts = await indexer.reindexAll();
        return json({ success: true, message: 'Reindexing complete', counts });
      }

      case 'clear-old-data': {
        const analytics = new SearchAnalytics(db);
        const daysToKeep = parseInt(formData.get('daysToKeep') as string || '90', 10);
        const deletedCount = await analytics.clearOldSearchData(daysToKeep);
        return json({
          success: true,
          message: `Cleared ${deletedCount} old search records`
        });
      }

      default:
        return json({ success: false, message: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    console.error('Admin action failed:', error);
    return json({ success: false, message: 'Action failed' }, { status: 500 });
  }
}

export default function AdminSearchDashboard() {
  const data = useLoaderData<LoaderData>();
  const fetcher = useFetcher();
  const [timeRange, setTimeRange] = useState(30);

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const formatPercentage = (num: number) => `${num.toFixed(1)}%`;

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const handleReindex = () => {
    if (confirm('Are you sure you want to reindex all search content? This may take a few minutes.')) {
      fetcher.submit(
        { action: 'reindex' },
        { method: 'post' }
      );
    }
  };

  const handleClearOldData = () => {
    const daysToKeep = prompt('Keep search data for how many days?', '90');
    if (daysToKeep && confirm(`Clear search data older than ${daysToKeep} days?`)) {
      fetcher.submit(
        { action: 'clear-old-data', daysToKeep },
        { method: 'post' }
      );
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <h1 className="text-3xl font-bold text-gray-900">Search Analytics</h1>
            <div className="flex items-center space-x-4">
              <select
                value={timeRange}
                onChange={(e) => setTimeRange(parseInt(e.target.value))}
                className="border border-gray-300 rounded-md px-3 py-2"
              >
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
              </select>
              <Link
                to="/admin/users"
                className="text-blue-600 hover:text-blue-800"
              >
                ← Back to Admin
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Action Messages */}
      {fetcher.data && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-4">
          <div
            className={`p-4 rounded-md ${
              fetcher.data.success
                ? 'bg-green-100 text-green-800'
                : 'bg-red-100 text-red-800'
            }`}
          >
            {fetcher.data.message}
            {fetcher.data.counts && (
              <div className="mt-2 text-sm">
                Indexed: {fetcher.data.counts.documents} documents,
                {fetcher.data.counts.comments} comments,
                {fetcher.data.counts.suggestions} suggestions,
                {fetcher.data.counts.discussions} discussions,
                {fetcher.data.counts.messages} messages
              </div>
            )}
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Key Metrics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-500">Total Searches</div>
            <div className="mt-2 text-3xl font-bold text-gray-900">
              {formatNumber(data.metrics.totalSearches)}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-500">Unique Users</div>
            <div className="mt-2 text-3xl font-bold text-gray-900">
              {formatNumber(data.metrics.uniqueUsers)}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-500">Click-through Rate</div>
            <div className="mt-2 text-3xl font-bold text-green-600">
              {formatPercentage(data.metrics.clickThroughRate)}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-500">No Results Rate</div>
            <div className="mt-2 text-3xl font-bold text-red-600">
              {formatPercentage(data.metrics.noResultsRate)}
            </div>
          </div>
        </div>

        {/* Performance Stats */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow">
            <div className="p-6">
              <h2 className="text-lg font-medium text-gray-900 mb-4">Response Times</h2>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-gray-600">P50 (Median)</span>
                  <span className="font-medium">{data.performanceStats.p50ResponseTime}ms</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">P95</span>
                  <span className="font-medium">{data.performanceStats.p95ResponseTime}ms</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">P99</span>
                  <span className="font-medium">{data.performanceStats.p99ResponseTime}ms</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Average</span>
                  <span className="font-medium">
                    {data.metrics.avgResponseTime.toFixed(0)}ms
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow">
            <div className="p-6">
              <h2 className="text-lg font-medium text-gray-900 mb-4">Index Statistics</h2>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-gray-600">Documents</span>
                  <span className="font-medium">{formatNumber(data.indexStats.documents)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Comments</span>
                  <span className="font-medium">{formatNumber(data.indexStats.comments)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Suggestions</span>
                  <span className="font-medium">{formatNumber(data.indexStats.suggestions)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Discussions</span>
                  <span className="font-medium">{formatNumber(data.indexStats.discussions)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Messages</span>
                  <span className="font-medium">{formatNumber(data.indexStats.messages)}</span>
                </div>
                <div className="pt-3 border-t">
                  <div className="flex justify-between">
                    <span className="text-gray-900 font-medium">Total Indexed</span>
                    <span className="font-bold">{formatNumber(data.indexStats.totalSize)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Top Queries */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow">
            <div className="p-6">
              <h2 className="text-lg font-medium text-gray-900 mb-4">Top Searches</h2>
              <div className="space-y-2">
                {data.metrics.topQueries.map((query, index) => (
                  <div key={query.query} className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <span className="text-sm text-gray-500 w-6">{index + 1}.</span>
                      <span className="text-sm font-medium text-gray-900">{query.query}</span>
                    </div>
                    <span className="text-sm text-gray-500">{query.count} searches</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow">
            <div className="p-6">
              <h2 className="text-lg font-medium text-gray-900 mb-4">No Results Queries</h2>
              {data.metrics.topNoResultsQueries.length > 0 ? (
                <div className="space-y-2">
                  {data.metrics.topNoResultsQueries.map((query, index) => (
                    <div key={query.query} className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <span className="text-sm text-gray-500 w-6">{index + 1}.</span>
                        <span className="text-sm font-medium text-gray-900">{query.query}</span>
                      </div>
                      <span className="text-sm text-gray-500">{query.count} searches</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500">No failed searches found</p>
              )}
            </div>
          </div>
        </div>

        {/* Popular Searches Table */}
        <div className="bg-white rounded-lg shadow mb-8">
          <div className="p-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">Popular Searches</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead>
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Query
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Count
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Avg Results
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      CTR
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Last Searched
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {data.popularSearches.map((search) => (
                    <tr key={search.query}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {search.query}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {search.searchCount}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {search.avgResultCount.toFixed(1)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {formatPercentage(search.clickThroughRate)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {formatDate(search.lastSearchedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Slowest Queries */}
        {data.performanceStats.slowestQueries.length > 0 && (
          <div className="bg-white rounded-lg shadow mb-8">
            <div className="p-6">
              <h2 className="text-lg font-medium text-gray-900 mb-4">Slowest Queries</h2>
              <div className="space-y-2">
                {data.performanceStats.slowestQueries.map((query, index) => (
                  <div key={index} className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-900">{query.query}</span>
                    <span className="text-sm text-red-600">{query.responseTime}ms</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Maintenance Actions */}
        <div className="bg-white rounded-lg shadow">
          <div className="p-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">Maintenance</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-gray-900">Re-index All Content</h3>
                  <p className="text-sm text-gray-500">
                    Rebuild the search index from scratch. Use when search results seem incorrect.
                  </p>
                </div>
                <button
                  onClick={handleReindex}
                  disabled={fetcher.state === 'submitting'}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  {fetcher.state === 'submitting' ? 'Reindexing...' : 'Reindex'}
                </button>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-gray-900">Clear Old Search Data</h3>
                  <p className="text-sm text-gray-500">
                    Remove old search queries for privacy and performance.
                  </p>
                </div>
                <button
                  onClick={handleClearOldData}
                  disabled={fetcher.state === 'submitting'}
                  className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
                >
                  Clear Data
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
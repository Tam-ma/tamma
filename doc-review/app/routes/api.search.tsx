import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import { getDb } from '../lib/db/client.server';
import { SearchQueryBuilder } from '../lib/search/query-builder.server';
import { requireAuth } from '../lib/auth/session.server';

/**
 * Search API Endpoint
 * GET /api/search?q=keyword&type=comments&docPath=/docs/foo.md&userId=user-123&status=open&before=2024-01-01&after=2024-01-01
 */

export async function loader({ request, context }: LoaderFunctionArgs) {
  // Check if user is authenticated (optional - can allow anonymous search)
  let userId: string | undefined;
  try {
    const user = await requireAuth(request, context);
    userId = user.id;
  } catch {
    // Allow anonymous search
  }

  const env = context.env as { DB: D1Database };
  const db = getDb(env);
  const url = new URL(request.url);

  // Extract query parameters
  const query = url.searchParams.get('q') || '';
  const type = url.searchParams.get('type') as any;
  const docPath = url.searchParams.get('docPath');
  const filterUserId = url.searchParams.get('userId');
  const status = url.searchParams.get('status');
  const before = url.searchParams.get('before');
  const after = url.searchParams.get('after');
  const resolved = url.searchParams.get('resolved');
  const limit = parseInt(url.searchParams.get('limit') || '20', 10);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);

  // Validate input
  if (!query || query.length < 2) {
    return json(
      {
        error: 'Query must be at least 2 characters long',
        results: [],
        total: 0,
        facets: { types: {}, statuses: {}, authors: [] }
      },
      { status: 400 }
    );
  }

  if (query.length > 1000) {
    return json(
      {
        error: 'Query must not exceed 1000 characters',
        results: [],
        total: 0,
        facets: { types: {}, statuses: {}, authors: [] }
      },
      { status: 400 }
    );
  }

  try {
    // Build and execute search query
    const builder = new SearchQueryBuilder(db);

    builder.search(query);

    // Apply filters
    if (type) {
      builder.filterByType(type);
    }

    if (docPath) {
      builder.filterByDocPath(docPath);
    }

    if (filterUserId) {
      builder.filterByUser(filterUserId);
    }

    if (status) {
      builder.filterByStatus(status);
    }

    if (before || after) {
      builder.filterByDateRange(before || undefined, after || undefined);
    }

    if (resolved !== null) {
      builder.filterByResolved(resolved === 'true');
    }

    // Apply pagination
    builder.paginate(limit, offset);

    // Execute search
    const searchResults = await builder.execute();

    // Add CORS headers for API access
    const headers = {
      'Cache-Control': 'public, max-age=60', // Cache for 1 minute
      'X-Total-Results': searchResults.total.toString(),
    };

    return json(searchResults, { headers });

  } catch (error) {
    console.error('Search failed:', error);
    return json(
      {
        error: 'Search failed',
        results: [],
        total: 0,
        facets: { types: {}, statuses: {}, authors: [] }
      },
      { status: 500 }
    );
  }
}
import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import { getDb } from '../lib/db/client.server';
import { SearchQueryBuilder } from '../lib/search/query-builder.server';

/**
 * Search Suggestions/Autocomplete Endpoint
 * GET /api/search/suggestions?q=partial
 *
 * Returns top 10 search suggestions based on:
 * 1. Popular searches matching the query
 * 2. Recent searches by the user (if authenticated)
 * 3. Document titles matching the query
 */

interface Suggestion {
  text: string;
  type: 'popular' | 'recent' | 'document' | 'author';
  count?: number;
  lastUsed?: number;
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.env as { DB: D1Database };
  const db = getDb(env);
  const url = new URL(request.url);

  // Extract query parameter
  const query = url.searchParams.get('q') || '';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '10', 10), 20);

  // Require at least 2 characters
  if (query.length < 2) {
    return json({ suggestions: [] });
  }

  // Limit query length
  if (query.length > 100) {
    return json({ suggestions: [] }, { status: 400 });
  }

  try {
    const suggestions: Suggestion[] = [];
    const seen = new Set<string>();

    // 1. Get popular searches matching the query
    const popularSearches = await db.all<{
      query: string;
      search_count: number;
      last_searched_at: number;
    }>(
      `SELECT query, search_count, last_searched_at
       FROM search_popular
       WHERE LOWER(query) LIKE LOWER(?) || '%'
       ORDER BY search_count DESC, last_searched_at DESC
       LIMIT ?`,
      [query, Math.ceil(limit / 2)]
    );

    for (const search of popularSearches) {
      if (!seen.has(search.query.toLowerCase())) {
        suggestions.push({
          text: search.query,
          type: 'popular',
          count: search.search_count,
          lastUsed: search.last_searched_at
        });
        seen.add(search.query.toLowerCase());
      }
    }

    // 2. Get user's recent searches (if authenticated)
    const authHeader = request.headers.get('Cookie');
    if (authHeader && authHeader.includes('auth-session')) {
      try {
        // Extract user ID from session (simplified - you'd use proper session validation)
        const userId = await getUserIdFromSession(request, context);

        if (userId) {
          const recentSearches = await db.all<{
            query: string;
            created_at: number;
          }>(
            `SELECT DISTINCT query, MAX(created_at) as created_at
             FROM search_history
             WHERE user_id = ? AND LOWER(query) LIKE LOWER(?) || '%'
             GROUP BY query
             ORDER BY created_at DESC
             LIMIT ?`,
            [userId, query, Math.ceil(limit / 3)]
          );

          for (const search of recentSearches) {
            if (!seen.has(search.query.toLowerCase())) {
              suggestions.push({
                text: search.query,
                type: 'recent',
                lastUsed: search.created_at
              });
              seen.add(search.query.toLowerCase());
            }
          }
        }
      } catch {
        // Ignore auth errors for autocomplete
      }
    }

    // 3. Get document titles matching the query
    const documents = await db.all<{
      doc_path: string;
      title: string;
    }>(
      `SELECT doc_path, title
       FROM document_metadata
       WHERE LOWER(title) LIKE '%' || LOWER(?) || '%'
       ORDER BY
         CASE
           WHEN LOWER(title) LIKE LOWER(?) || '%' THEN 1
           ELSE 2
         END,
         LENGTH(title)
       LIMIT ?`,
      [query, query, Math.ceil(limit / 3)]
    );

    for (const doc of documents) {
      if (!seen.has(doc.title.toLowerCase()) && suggestions.length < limit) {
        suggestions.push({
          text: doc.title,
          type: 'document'
        });
        seen.add(doc.title.toLowerCase());
      }
    }

    // 4. Get author names matching the query
    const authors = await db.all<{
      name: string;
      comment_count: number;
    }>(
      `SELECT u.name, COUNT(c.id) as comment_count
       FROM users u
       LEFT JOIN comments c ON u.id = c.user_id
       WHERE LOWER(u.name) LIKE '%' || LOWER(?) || '%'
       GROUP BY u.id, u.name
       ORDER BY comment_count DESC
       LIMIT ?`,
      [query, Math.ceil(limit / 4)]
    );

    for (const author of authors) {
      const searchText = `author:${author.name}`;
      if (!seen.has(searchText.toLowerCase()) && suggestions.length < limit) {
        suggestions.push({
          text: searchText,
          type: 'author',
          count: author.comment_count
        });
        seen.add(searchText.toLowerCase());
      }
    }

    // Sort suggestions by relevance
    suggestions.sort((a, b) => {
      // Prioritize exact prefix matches
      const aStartsWith = a.text.toLowerCase().startsWith(query.toLowerCase());
      const bStartsWith = b.text.toLowerCase().startsWith(query.toLowerCase());
      if (aStartsWith && !bStartsWith) return -1;
      if (!aStartsWith && bStartsWith) return 1;

      // Then by type priority: popular > recent > document > author
      const typePriority = { popular: 0, recent: 1, document: 2, author: 3 };
      const typeDiff = typePriority[a.type] - typePriority[b.type];
      if (typeDiff !== 0) return typeDiff;

      // Then by count (for popular searches)
      if (a.count && b.count) {
        return b.count - a.count;
      }

      // Then by recency
      if (a.lastUsed && b.lastUsed) {
        return b.lastUsed - a.lastUsed;
      }

      // Finally by text length (shorter first)
      return a.text.length - b.text.length;
    });

    // Limit to requested number
    const limitedSuggestions = suggestions.slice(0, limit);

    // Cache for 5 minutes for popular queries
    const headers: HeadersInit = {};
    if (popularSearches.length > 0) {
      headers['Cache-Control'] = 'public, max-age=300';
    }

    return json(
      {
        suggestions: limitedSuggestions.map(s => ({
          text: s.text,
          type: s.type,
          metadata: {
            count: s.count,
            lastUsed: s.lastUsed
          }
        }))
      },
      { headers }
    );

  } catch (error) {
    console.error('Failed to get search suggestions:', error);
    return json({ suggestions: [] }, { status: 500 });
  }
}

/**
 * Helper to extract user ID from session
 */
async function getUserIdFromSession(
  request: Request,
  context: any
): Promise<string | null> {
  try {
    const { getSession } = await import('../lib/auth/session.server');
    const session = await getSession(request.headers.get('Cookie'));
    return session.get('userId') || null;
  } catch {
    return null;
  }
}
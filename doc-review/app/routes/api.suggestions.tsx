import { and, desc, eq, isNull, or } from 'drizzle-orm';
import * as Diff from 'diff';
import { requireAuthWithRole } from '~/lib/auth/middleware';
import { Permission, hasPermission, canApprove, canDeleteResource, logPermissionViolation } from '~/lib/auth/permissions';
import { getDb, hasDatabase } from '~/lib/db/client.server';
import { reviewSessions, suggestions, users } from '~/lib/db/schema';
import { syncUserRecord } from '~/lib/db/users.server';
import { validateSuggestionPayload, validateSuggestionUpdatePayload, ValidationError } from '~/lib/collaboration/validators';
import { jsonResponse } from '~/lib/utils/responses';
import { parseRequestPayload } from '~/lib/utils/request.server';
import { parseDocPaths } from '~/lib/db/sessions.server';
import { getGitProvider } from '~/lib/git/provider.server';
import type { GitProvider } from '~/lib/git/types';
import { publishSuggestionEvent } from '~/lib/events/publisher.server';

interface LoaderParams {
  request: Request;
  context: any;
  params: { id?: string };
}

interface ActionParams {
  request: Request;
  context: any;
  params: { id?: string };
}

/**
 * GET /api/suggestions - List suggestions with filters
 * GET /api/suggestions/:id - Get a specific suggestion
 */
export async function loader({ request, context, params }: LoaderParams) {
  const env = context.env ?? context.cloudflare?.env ?? {};
  // Anyone authenticated can read suggestions
  const user = await requireAuthWithRole(request, context);

  if (!hasDatabase(env)) {
    return jsonResponse({ suggestions: [], message: 'Database not configured.' });
  }

  const db = getDb(env);

  // Handle single suggestion retrieval
  if (params.id) {
    const suggestion = await db
      .select({
        id: suggestions.id,
        docPath: suggestions.docPath,
        description: suggestions.description,
        originalText: suggestions.originalText,
        suggestedText: suggestions.suggestedText,
        lineStart: suggestions.lineStart,
        lineEnd: suggestions.lineEnd,
        status: suggestions.status,
        userId: suggestions.userId,
        sessionId: suggestions.sessionId,
        reviewedBy: suggestions.reviewedBy,
        reviewedAt: suggestions.reviewedAt,
        createdAt: suggestions.createdAt,
        updatedAt: suggestions.updatedAt,
        author: {
          id: users.id,
          name: users.name,
          avatarUrl: users.avatarUrl,
        },
        session: {
          id: reviewSessions.id,
          title: reviewSessions.title,
          status: reviewSessions.status,
          prNumber: reviewSessions.prNumber,
          prUrl: reviewSessions.prUrl,
        },
      })
      .from(suggestions)
      .leftJoin(users, eq(users.id, suggestions.userId))
      .leftJoin(reviewSessions, eq(reviewSessions.id, suggestions.sessionId))
      .where(and(
        eq(suggestions.id, params.id),
        isNull(suggestions.deletedAt)
      ))
      .get();

    if (!suggestion) {
      return jsonResponse({ error: 'Suggestion not found.' }, { status: 404 });
    }

    // Generate diff for the suggestion
    const diff = Diff.createPatch(
      suggestion.docPath,
      suggestion.originalText,
      suggestion.suggestedText,
      'original',
      'suggested'
    );

    return jsonResponse({
      suggestion: {
        ...suggestion,
        diff
      }
    });
  }

  // Handle listing suggestions with filters
  const url = new URL(request.url);
  const docPath = url.searchParams.get('docPath');
  const status = url.searchParams.get('status');
  const sessionId = url.searchParams.get('sessionId');
  const userId = url.searchParams.get('userId');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 50);
  const offset = parseInt(url.searchParams.get('offset') || '0');

  // Build dynamic where clause
  const conditions = [];

  // Always exclude soft-deleted suggestions
  conditions.push(isNull(suggestions.deletedAt));

  if (docPath) conditions.push(eq(suggestions.docPath, docPath));
  if (status) conditions.push(eq(suggestions.status, status));
  if (sessionId) conditions.push(eq(suggestions.sessionId, sessionId));
  if (userId) conditions.push(eq(suggestions.userId, userId));

  const whereClause = conditions.length === 1
    ? conditions[0]
    : and(...conditions);

  let query = db
    .select({
      id: suggestions.id,
      docPath: suggestions.docPath,
      description: suggestions.description,
      originalText: suggestions.originalText,
      suggestedText: suggestions.suggestedText,
      lineStart: suggestions.lineStart,
      lineEnd: suggestions.lineEnd,
      status: suggestions.status,
      userId: suggestions.userId,
      sessionId: suggestions.sessionId,
      reviewedBy: suggestions.reviewedBy,
      reviewedAt: suggestions.reviewedAt,
      createdAt: suggestions.createdAt,
      updatedAt: suggestions.updatedAt,
      author: {
        id: users.id,
        name: users.name,
        avatarUrl: users.avatarUrl,
      },
      session: {
        id: reviewSessions.id,
        title: reviewSessions.title,
        status: reviewSessions.status,
        prNumber: reviewSessions.prNumber,
        prUrl: reviewSessions.prUrl,
      },
    })
    .from(suggestions)
    .leftJoin(users, eq(users.id, suggestions.userId))
    .leftJoin(reviewSessions, eq(reviewSessions.id, suggestions.sessionId))
    .$dynamic();

  query = query.where(whereClause);

  const results = await query
    .orderBy(desc(suggestions.createdAt))
    .limit(limit)
    .offset(offset)
    .all();

  // Add diff to each suggestion
  const suggestionsWithDiff = results.map(suggestion => ({
    ...suggestion,
    diff: Diff.createPatch(
      suggestion.docPath,
      suggestion.originalText,
      suggestion.suggestedText,
      'original',
      'suggested'
    )
  }));

  return jsonResponse({
    suggestions: suggestionsWithDiff,
    pagination: {
      limit,
      offset,
      hasMore: results.length === limit
    }
  });
}

/**
 * Handle POST, PATCH, DELETE operations for suggestions
 */
export async function action({ request, context, params }: ActionParams) {
  const env = context.env ?? context.cloudflare?.env ?? {};
  const user = await requireAuthWithRole(request, context);

  if (!hasDatabase(env)) {
    return jsonResponse({ error: 'Database not configured.' }, { status: 503 });
  }

  const db = getDb(env);

  // Handle DELETE /api/suggestions/:id
  if (request.method === 'DELETE' && params.id) {
    // Check if suggestion exists and user owns it or is admin
    const existing = await db
      .select()
      .from(suggestions)
      .where(eq(suggestions.id, params.id))
      .get();

    if (!existing) {
      return jsonResponse({ error: 'Suggestion not found.' }, { status: 404 });
    }

    // Check permission - only owner or admin can delete
    if (!canDeleteResource(user, existing.userId)) {
      logPermissionViolation(user, Permission.DELETE_ANY, {
        action: 'delete_suggestion',
        suggestionId: params.id,
        ownerId: existing.userId,
      });
      return jsonResponse({ error: 'Unauthorized to delete this suggestion.' }, { status: 403 });
    }

    // Soft delete by setting deleted_at timestamp
    const now = Date.now();
    await db
      .update(suggestions)
      .set({
        updatedAt: now,
        deletedAt: now,
        status: 'deleted'
      })
      .where(eq(suggestions.id, params.id));

    // Publish real-time event (deletion is not published as suggestions are soft-deleted)
    // We could publish this if needed for UI updates

    return jsonResponse({
      message: 'Suggestion deleted successfully.',
      ok: true
    });
  }

  // Handle PATCH /api/suggestions/:id
  if (request.method === 'PATCH' && params.id) {
    const body = await parseRequestPayload(request);

    try {
      const payload = validateSuggestionUpdatePayload(body);

      // Check if suggestion exists
      const existing = await db
        .select()
        .from(suggestions)
        .where(eq(suggestions.id, params.id))
        .get();

      if (!existing) {
        return jsonResponse({ error: 'Suggestion not found.' }, { status: 404 });
      }

      // Check permission for status changes
      if (payload.status && payload.status !== existing.status) {
        // Only admins can approve/reject suggestions
        if (payload.status === 'approved' || payload.status === 'rejected') {
          if (!canApprove(user)) {
            logPermissionViolation(user, Permission.APPROVE, {
              action: 'update_suggestion_status',
              suggestionId: params.id,
              newStatus: payload.status,
            });
            return jsonResponse({
              error: 'Only admins can approve or reject suggestions.'
            }, { status: 403 });
          }
        }
      }

      const now = Date.now();
      const updates: any = {
        updatedAt: now,
      };

      // Add fields that can be updated
      if (payload.description !== undefined) {
        updates.description = payload.description;
      }

      if (payload.status !== undefined) {
        updates.status = payload.status;

        // Track who reviewed it
        if (payload.status === 'approved' || payload.status === 'rejected') {
          updates.reviewedBy = user.id;
          updates.reviewedAt = now;
        }
      }

      // Update the suggestion
      await db
        .update(suggestions)
        .set(updates)
        .where(eq(suggestions.id, params.id));

      // If approved, create or update PR
      if (payload.status === 'approved' && existing.sessionId) {
        try {
          // Get the session details
          const session = await db
            .select()
            .from(reviewSessions)
            .where(eq(reviewSessions.id, existing.sessionId))
            .get();

          if (session) {
            // Initialize Git provider
            const provider = getGitProvider(env);

            // Create diff for PR
            const diff = Diff.createPatch(
              existing.docPath,
              existing.originalText,
              existing.suggestedText,
              'original',
              'suggested'
            );

            // Apply the suggestion to the session's branch
            const result = await provider.appendSuggestionPatch({
              sessionId: existing.sessionId,
              docPath: existing.docPath,
              diff
            });

            // Update session with PR info if not already set
            if (!session.prNumber) {
              const prMeta = await provider.ensureSessionPullRequest({
                sessionId: existing.sessionId,
                title: session.title,
                summary: session.summary,
                docPaths: parseDocPaths(session.docPaths),
              });

              await db
                .update(reviewSessions)
                .set({
                  branch: prMeta.branch,
                  prNumber: prMeta.prNumber,
                  prUrl: prMeta.prUrl,
                  status: prMeta.status as any,
                  updatedAt: now,
                })
                .where(eq(reviewSessions.id, existing.sessionId));
            }
          }
        } catch (error) {
          console.error('Failed to create/update PR:', error);
          // Don't fail the request, PR creation is secondary
        }
      }

      // Get updated suggestion
      const updated = await db
        .select({
          id: suggestions.id,
          docPath: suggestions.docPath,
          description: suggestions.description,
          originalText: suggestions.originalText,
          suggestedText: suggestions.suggestedText,
          lineStart: suggestions.lineStart,
          lineEnd: suggestions.lineEnd,
          status: suggestions.status,
          userId: suggestions.userId,
          sessionId: suggestions.sessionId,
          reviewedBy: suggestions.reviewedBy,
          reviewedAt: suggestions.reviewedAt,
          createdAt: suggestions.createdAt,
          updatedAt: suggestions.updatedAt,
        })
        .from(suggestions)
        .where(eq(suggestions.id, params.id))
        .get();

      // Publish real-time event
      if (payload.status === 'approved') {
        await publishSuggestionEvent(context, existing.docPath, 'approved', updated, user.id);
      } else {
        await publishSuggestionEvent(context, existing.docPath, 'updated', updated, user.id);
      }

      return jsonResponse({
        suggestion: updated,
        ok: true
      });
    } catch (error) {
      if (error instanceof ValidationError) {
        return jsonResponse({ error: error.message }, { status: 400 });
      }

      console.error(error);
      return jsonResponse({ error: 'Failed to update suggestion.' }, { status: 500 });
    }
  }

  // Handle POST /api/suggestions - Create new suggestion
  if (request.method === 'POST') {
    // Check if user has permission to create suggestions
    if (!hasPermission(user, Permission.SUGGEST)) {
      logPermissionViolation(user, Permission.SUGGEST, {
        action: 'create_suggestion',
        endpoint: '/api/suggestions',
      });
      return jsonResponse(
        {
          error: 'Forbidden',
          message: 'You need reviewer role or higher to create suggestions',
          requiredPermission: Permission.SUGGEST,
        },
        { status: 403 }
      );
    }

    const body = await parseRequestPayload(request);

    try {
      const payload = validateSuggestionPayload(body);
      await syncUserRecord(env, user);

      // If sessionId provided, verify it exists and document is part of it
      if (payload.sessionId) {
        const session = await db
          .select()
          .from(reviewSessions)
          .where(eq(reviewSessions.id, payload.sessionId))
          .get();

        if (!session) {
          return jsonResponse({ error: 'Review session not found.' }, { status: 404 });
        }

        const docPaths = parseDocPaths(session.docPaths);
        if (!docPaths.includes(payload.docPath)) {
          return jsonResponse({
            error: 'Document is not part of the selected session.'
          }, { status: 400 });
        }
      }

      const id = crypto.randomUUID();
      const now = Date.now();

      // Generate diff preview
      const diff = Diff.createPatch(
        payload.docPath,
        payload.originalText,
        payload.suggestedText,
        'original',
        'suggested'
      );

      await db.insert(suggestions).values({
        id,
        docPath: payload.docPath,
        description: payload.description || null,
        originalText: payload.originalText,
        suggestedText: payload.suggestedText,
        lineStart: payload.lineStart,
        lineEnd: payload.lineEnd,
        status: 'pending',
        sessionId: payload.sessionId || null,
        createdAt: now,
        updatedAt: now,
        userId: user.id,
      });

      const created = await db
        .select({
          id: suggestions.id,
          docPath: suggestions.docPath,
          description: suggestions.description,
          originalText: suggestions.originalText,
          suggestedText: suggestions.suggestedText,
          lineStart: suggestions.lineStart,
          lineEnd: suggestions.lineEnd,
          status: suggestions.status,
          userId: suggestions.userId,
          sessionId: suggestions.sessionId,
          createdAt: suggestions.createdAt,
          updatedAt: suggestions.updatedAt,
        })
        .from(suggestions)
        .where(eq(suggestions.id, id))
        .get();

      // Publish real-time event
      await publishSuggestionEvent(context, payload.docPath, 'created', created, user.id);

      return jsonResponse({
        suggestion: {
          ...created,
          diff
        },
        ok: true
      }, { status: 201 });
    } catch (error) {
      if (error instanceof ValidationError) {
        return jsonResponse({ error: error.message }, { status: 400 });
      }

      console.error(error);
      return jsonResponse({ error: 'Failed to create suggestion.' }, { status: 500 });
    }
  }

  return jsonResponse({ error: 'Method not allowed' }, { status: 405 });
}
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { requireAuthWithRole } from '~/lib/auth/middleware';
import { Permission, hasPermission, logPermissionViolation } from '~/lib/auth/permissions';
import { getDb, hasDatabase } from '~/lib/db/client.server';
import { comments, users } from '~/lib/db/schema';
import {
  validateCommentPayload,
  ValidationError
} from '~/lib/collaboration/validators';
import { syncUserRecord } from '~/lib/db/users.server';
import { jsonResponse } from '~/lib/utils/responses';
import { parseRequestPayload } from '~/lib/utils/request.server';
import { publishCommentEvent } from '~/lib/events/publisher.server';

// GET /api/comments - List comments with filtering and pagination
export async function loader({ request, context }: any) {
  const env = context.env ?? context.cloudflare?.env ?? {};

  // Anyone authenticated can read comments
  const user = await requireAuthWithRole(request, context);

  if (!hasDatabase(env)) {
    return jsonResponse({ comments: [], message: 'Database not configured.' });
  }

  const url = new URL(request.url);
  const docPath = url.searchParams.get('docPath');
  const lineNumber = url.searchParams.get('lineNumber');
  const userId = url.searchParams.get('userId');
  const parentId = url.searchParams.get('parentId');
  const includeDeleted = url.searchParams.get('includeDeleted') === 'true';
  const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 100);
  const offset = Number(url.searchParams.get('offset')) || 0;

  // Build where conditions
  const conditions = [];

  if (docPath) {
    conditions.push(eq(comments.docPath, docPath));
  }

  if (lineNumber) {
    const line = Number(lineNumber);
    if (Number.isFinite(line)) {
      conditions.push(eq(comments.lineNumber, line));
    }
  }

  if (userId) {
    conditions.push(eq(comments.userId, userId));
  }

  if (parentId === 'null') {
    // Get only top-level comments
    conditions.push(isNull(comments.parentId));
  } else if (parentId) {
    // Get replies to specific comment
    conditions.push(eq(comments.parentId, parentId));
  }

  // Exclude soft-deleted comments unless explicitly requested
  if (!includeDeleted) {
    conditions.push(isNull(comments.deletedAt));
  }

  const db = getDb(env);
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  try {
    const results = await db
      .select({
        id: comments.id,
        docPath: comments.docPath,
        content: comments.content,
        lineNumber: comments.lineNumber,
        lineContent: comments.lineContent,
        resolved: comments.resolved,
        userId: comments.userId,
        parentId: comments.parentId,
        createdAt: comments.createdAt,
        updatedAt: comments.updatedAt,
        deletedAt: comments.deletedAt,
        author: {
          id: users.id,
          name: users.name,
          avatarUrl: users.avatarUrl,
          role: users.role,
        },
      })
      .from(comments)
      .leftJoin(users, eq(users.id, comments.userId))
      .where(whereClause)
      .orderBy(desc(comments.createdAt))
      .limit(limit)
      .offset(offset)
      .all();

    // Get total count for pagination
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(comments)
      .where(whereClause)
      .get();

    const total = countResult?.count || 0;

    return jsonResponse({
      comments: results,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + results.length < total
      }
    });
  } catch (error) {
    console.error('Failed to fetch comments:', error);
    return jsonResponse({ error: 'Failed to fetch comments.' }, { status: 500 });
  }
}

// POST /api/comments - Create new comment
export async function action({ request, context }: any) {
  const env = context.env ?? context.cloudflare?.env ?? {};

  // Check permissions based on method
  const user = await requireAuthWithRole(request, context);

  if (!hasDatabase(env)) {
    return jsonResponse({ error: 'Database not configured.' }, { status: 503 });
  }

  if (request.method === 'POST') {
    // Require comment permission for creating comments
    if (!hasPermission(user, Permission.COMMENT)) {
      logPermissionViolation(user, Permission.COMMENT, {
        action: 'create_comment',
        endpoint: '/api/comments',
      });
      return jsonResponse(
        {
          error: 'Forbidden',
          message: 'You need reviewer role or higher to comment',
          requiredPermission: Permission.COMMENT,
        },
        { status: 403 }
      );
    }
  } else if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, { status: 405 });
  }

  const db = getDb(env);

  try {
    const body = await parseRequestPayload(request);
    const payload = validateCommentPayload(body);

    // Sync user record to ensure it exists
    await syncUserRecord(env, user);

    // Validate parent comment exists if parentId provided
    if (payload.parentId) {
      const parent = await db
        .select()
        .from(comments)
        .where(eq(comments.id, payload.parentId))
        .get();

      if (!parent) {
        return jsonResponse({ error: 'Parent comment not found.' }, { status: 404 });
      }

      // Ensure we're commenting on the same document
      if (parent.docPath !== payload.docPath) {
        return jsonResponse({
          error: 'Parent comment is from a different document.'
        }, { status: 400 });
      }
    }

    const id = crypto.randomUUID();
    const now = Date.now();

    await db.insert(comments).values({
      id,
      docPath: payload.docPath,
      lineNumber: payload.lineNumber ?? null,
      lineContent: payload.lineContent ?? null,
      content: payload.content,
      userId: user.id,
      parentId: payload.parentId ?? null,
      resolved: false,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });

    // Fetch created comment with author information
    const created = await db
      .select({
        id: comments.id,
        docPath: comments.docPath,
        content: comments.content,
        lineNumber: comments.lineNumber,
        lineContent: comments.lineContent,
        resolved: comments.resolved,
        userId: comments.userId,
        parentId: comments.parentId,
        createdAt: comments.createdAt,
        updatedAt: comments.updatedAt,
        author: {
          id: users.id,
          name: users.name,
          avatarUrl: users.avatarUrl,
          role: users.role,
        },
      })
      .from(comments)
      .leftJoin(users, eq(users.id, comments.userId))
      .where(eq(comments.id, id))
      .get();

    // Publish real-time event
    await publishCommentEvent(context, payload.docPath, 'created', created, user.id);

    return jsonResponse({ comment: created, ok: true }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return jsonResponse({ error: error.message }, { status: 400 });
    }

    console.error('Failed to create comment:', error);
    return jsonResponse({ error: 'Failed to create comment.' }, { status: 500 });
  }
}
import { and, eq, isNull } from 'drizzle-orm';
import { requireAuthWithRole } from '~/lib/auth/middleware';
import { canModifyResource, canDeleteResource, logPermissionViolation, Permission } from '~/lib/auth/permissions';
import { getDb, hasDatabase } from '~/lib/db/client.server';
import { comments, users } from '~/lib/db/schema';
import {
  validateCommentUpdatePayload,
  ValidationError
} from '~/lib/collaboration/validators';
import { jsonResponse } from '~/lib/utils/responses';
import { parseRequestPayload } from '~/lib/utils/request.server';
import { publishCommentEvent } from '~/lib/events/publisher.server';

// GET /api/comments/:id - Get a single comment
export async function loader({ request, context, params }: any) {
  const env = context.env ?? context.cloudflare?.env ?? {};
  // Anyone authenticated can read comments
  await requireAuthWithRole(request, context);

  if (!hasDatabase(env)) {
    return jsonResponse({ error: 'Database not configured.' }, { status: 503 });
  }

  const commentId = params.id;
  if (!commentId) {
    return jsonResponse({ error: 'Comment ID is required.' }, { status: 400 });
  }

  const db = getDb(env);

  try {
    const comment = await db
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
      .where(and(
        eq(comments.id, commentId),
        isNull(comments.deletedAt)
      ))
      .get();

    if (!comment) {
      return jsonResponse({ error: 'Comment not found.' }, { status: 404 });
    }

    return jsonResponse({ comment });
  } catch (error) {
    console.error('Failed to fetch comment:', error);
    return jsonResponse({ error: 'Failed to fetch comment.' }, { status: 500 });
  }
}

// Handle PATCH and DELETE operations for a specific comment
export async function action({ request, context, params }: any) {
  const env = context.env ?? context.cloudflare?.env ?? {};
  const user = await requireAuthWithRole(request, context);

  if (!hasDatabase(env)) {
    return jsonResponse({ error: 'Database not configured.' }, { status: 503 });
  }

  const commentId = params.id;
  if (!commentId) {
    return jsonResponse({ error: 'Comment ID is required.' }, { status: 400 });
  }

  const db = getDb(env);
  const method = request.method;

  try {
    switch (method) {
      case 'PATCH':
      case 'PUT':
        return await handleUpdateComment(db, request, user, commentId, context);

      case 'DELETE':
        return await handleDeleteComment(db, user, commentId, context);

      default:
        return jsonResponse({ error: 'Method not allowed' }, { status: 405 });
    }
  } catch (error) {
    if (error instanceof ValidationError) {
      return jsonResponse({ error: error.message }, { status: 400 });
    }

    console.error('API error:', error);
    return jsonResponse({ error: 'Internal server error.' }, { status: 500 });
  }
}

// PATCH /api/comments/:id - Update existing comment
async function handleUpdateComment(db: any, request: Request, user: any, commentId: string, context: any) {
  // First check if comment exists and user owns it
  const existing = await db
    .select()
    .from(comments)
    .where(and(
      eq(comments.id, commentId),
      isNull(comments.deletedAt)
    ))
    .get();

  if (!existing) {
    return jsonResponse({ error: 'Comment not found.' }, { status: 404 });
  }

  // Check authorization - only comment owner or admin can update
  if (!canModifyResource(user, existing.userId)) {
    logPermissionViolation(user, Permission.EDIT_ANY, {
      action: 'update_comment',
      commentId,
      ownerId: existing.userId,
    });
    return jsonResponse({
      error: 'You are not authorized to update this comment.'
    }, { status: 403 });
  }

  const body = await parseRequestPayload(request);
  const updates = validateCommentUpdatePayload(body);

  const updateData: any = {
    updatedAt: Date.now(),
  };

  if (updates.content !== undefined) {
    updateData.content = updates.content;
  }

  if (updates.resolved !== undefined) {
    updateData.resolved = updates.resolved;
  }

  await db
    .update(comments)
    .set(updateData)
    .where(eq(comments.id, commentId));

  // Fetch updated comment with author information
  const updated = await db
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
    .where(eq(comments.id, commentId))
    .get();

  // Publish real-time event
  await publishCommentEvent(context, existing.docPath, 'updated', updated, user.id);

  return jsonResponse({ comment: updated, ok: true });
}

// DELETE /api/comments/:id - Soft delete a comment
async function handleDeleteComment(db: any, user: any, commentId: string, context: any) {
  // First check if comment exists
  const existing = await db
    .select()
    .from(comments)
    .where(and(
      eq(comments.id, commentId),
      isNull(comments.deletedAt)
    ))
    .get();

  if (!existing) {
    return jsonResponse({ error: 'Comment not found.' }, { status: 404 });
  }

  // Check authorization - only comment owner or admin can delete
  if (!canDeleteResource(user, existing.userId)) {
    logPermissionViolation(user, Permission.DELETE_ANY, {
      action: 'delete_comment',
      commentId,
      ownerId: existing.userId,
    });
    return jsonResponse({
      error: 'You are not authorized to delete this comment.'
    }, { status: 403 });
  }

  // Perform soft delete by setting deletedAt timestamp
  const now = Date.now();
  await db
    .update(comments)
    .set({
      deletedAt: now,
      updatedAt: now,
    })
    .where(eq(comments.id, commentId));

  // Publish real-time event
  await publishCommentEvent(context, existing.docPath, 'deleted', { id: commentId }, user.id);

  return jsonResponse({
    message: 'Comment deleted successfully.',
    ok: true
  });
}
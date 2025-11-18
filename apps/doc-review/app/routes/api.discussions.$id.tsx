import { and, eq, isNull } from 'drizzle-orm';
import { requireAuthWithRole } from '~/lib/auth/middleware';
import { canModifyResource, canDeleteResource, logPermissionViolation, Permission } from '~/lib/auth/permissions';
import { getDb, hasDatabase } from '~/lib/db/client.server';
import { discussions, users } from '~/lib/db/schema';
import {
  validateDiscussionUpdatePayload,
  ValidationError
} from '~/lib/collaboration/validators';
import { jsonResponse } from '~/lib/utils/responses';
import { parseRequestPayload } from '~/lib/utils/request.server';

// GET /api/discussions/:id - Get a single discussion
export async function loader({ request, context, params }: any) {
  const env = context.env ?? context.cloudflare?.env ?? {};
  // Anyone authenticated can read discussions
  await requireAuthWithRole(request, context);

  if (!hasDatabase(env)) {
    return jsonResponse({ error: 'Database not configured.' }, { status: 503 });
  }

  const db = getDb(env);
  const { id } = params;

  if (!id) {
    return jsonResponse({ error: 'Discussion ID is required.' }, { status: 400 });
  }

  // Get discussion with author info
  const discussion = await db
    .select({
      id: discussions.id,
      docPath: discussions.docPath,
      title: discussions.title,
      description: discussions.description,
      status: discussions.status,
      userId: discussions.userId,
      sessionId: discussions.sessionId,
      createdAt: discussions.createdAt,
      updatedAt: discussions.updatedAt,
      author: {
        id: users.id,
        name: users.name,
        avatarUrl: users.avatarUrl,
      },
    })
    .from(discussions)
    .leftJoin(users, eq(users.id, discussions.userId))
    .where(and(
      eq(discussions.id, id),
      isNull(discussions.deletedAt)
    ))
    .get();

  if (!discussion) {
    return jsonResponse({ error: 'Discussion not found.' }, { status: 404 });
  }

  return jsonResponse({ discussion });
}

// PATCH /api/discussions/:id - Update discussion
// DELETE /api/discussions/:id - Delete discussion
export async function action({ request, context, params }: any) {
  const env = context.env ?? context.cloudflare?.env ?? {};
  const user = await requireAuthWithRole(request, context);

  if (!hasDatabase(env)) {
    return jsonResponse({ error: 'Database not configured.' }, { status: 503 });
  }

  const db = getDb(env);
  const { id } = params;

  if (!id) {
    return jsonResponse({ error: 'Discussion ID is required.' }, { status: 400 });
  }

  switch (request.method) {
    case 'PATCH':
      return updateDiscussion(db, id, request, user);
    case 'DELETE':
      return deleteDiscussion(db, id, user);
    default:
      return new Response('Method not allowed', { status: 405 });
  }
}

async function updateDiscussion(db: any, discussionId: string, request: Request, user: any) {
  const body = await parseRequestPayload(request);

  try {
    const payload = validateDiscussionUpdatePayload(body);

    // Check if discussion exists and user has permission
    const existing = await db
      .select()
      .from(discussions)
      .where(and(
        eq(discussions.id, discussionId),
        isNull(discussions.deletedAt)
      ))
      .get();

    if (!existing) {
      return jsonResponse({ error: 'Discussion not found.' }, { status: 404 });
    }

    // Only owner or admin can update
    if (!canModifyResource(user, existing.userId)) {
      logPermissionViolation(user, Permission.EDIT_ANY, {
        action: 'update_discussion',
        discussionId,
        ownerId: existing.userId,
      });
      return jsonResponse({ error: 'You do not have permission to update this discussion.' }, { status: 403 });
    }

    // Build update object
    const updates: any = {
      updatedAt: Date.now(),
    };

    if (payload.title !== undefined) updates.title = payload.title;
    if (payload.description !== undefined) updates.description = payload.description;
    if (payload.status !== undefined) updates.status = payload.status;

    // Update the discussion
    await db
      .update(discussions)
      .set(updates)
      .where(eq(discussions.id, discussionId));

    // Get updated discussion with author info
    const updated = await db
      .select({
        id: discussions.id,
        docPath: discussions.docPath,
        title: discussions.title,
        description: discussions.description,
        status: discussions.status,
        userId: discussions.userId,
        sessionId: discussions.sessionId,
        createdAt: discussions.createdAt,
        updatedAt: discussions.updatedAt,
        author: {
          id: users.id,
          name: users.name,
          avatarUrl: users.avatarUrl,
        },
      })
      .from(discussions)
      .leftJoin(users, eq(users.id, discussions.userId))
      .where(eq(discussions.id, discussionId))
      .get();

    return jsonResponse({ discussion: updated });
  } catch (error) {
    if (error instanceof ValidationError) {
      return jsonResponse({ error: error.message }, { status: 400 });
    }

    console.error('Failed to update discussion:', error);
    return jsonResponse({ error: 'Failed to update discussion.' }, { status: 500 });
  }
}

async function deleteDiscussion(db: any, discussionId: string, user: any) {
  // Check if discussion exists and user has permission
  const existing = await db
    .select()
    .from(discussions)
    .where(and(
      eq(discussions.id, discussionId),
      isNull(discussions.deletedAt)
    ))
    .get();

  if (!existing) {
    return jsonResponse({ error: 'Discussion not found.' }, { status: 404 });
  }

  // Only owner or admin can delete
  if (!canDeleteResource(user, existing.userId)) {
    logPermissionViolation(user, Permission.DELETE_ANY, {
      action: 'delete_discussion',
      discussionId,
      ownerId: existing.userId,
    });
    return jsonResponse({ error: 'You do not have permission to delete this discussion.' }, { status: 403 });
  }

  // Soft delete the discussion
  await db
    .update(discussions)
    .set({
      deletedAt: Date.now(),
      updatedAt: Date.now(),
    })
    .where(eq(discussions.id, discussionId));

  return jsonResponse({ success: true });
}
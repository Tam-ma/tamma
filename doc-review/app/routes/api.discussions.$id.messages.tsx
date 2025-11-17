import { and, asc, count, eq, isNull } from 'drizzle-orm';
import { requireAuth } from '~/lib/auth/session.server';
import { getDb, hasDatabase } from '~/lib/db/client.server';
import { discussions, discussionMessages, users } from '~/lib/db/schema';
import { syncUserRecord } from '~/lib/db/users.server';
import {
  validateDiscussionMessagePayload,
  ValidationError
} from '~/lib/collaboration/validators';
import { jsonResponse } from '~/lib/utils/responses';
import { parseRequestPayload } from '~/lib/utils/request.server';
import { publishDiscussionEvent } from '~/lib/events/publisher.server';

// GET /api/discussions/:id/messages - List messages in a discussion
export async function loader({ request, context, params }: any) {
  const env = context.env ?? context.cloudflare?.env ?? {};
  await requireAuth(request, { env });

  if (!hasDatabase(env)) {
    return jsonResponse({ error: 'Database not configured.' }, { status: 503 });
  }

  const db = getDb(env);
  const { id } = params;

  if (!id) {
    return jsonResponse({ error: 'Discussion ID is required.' }, { status: 400 });
  }

  try {
    // Verify discussion exists and is not deleted
    const discussion = await db
      .select()
      .from(discussions)
      .where(and(
        eq(discussions.id, id),
        isNull(discussions.deletedAt)
      ))
      .get();

    if (!discussion) {
      return jsonResponse({ error: 'Discussion not found.' }, { status: 404 });
    }

    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 100);
    const offset = parseInt(url.searchParams.get('offset') || '0');

    // Get messages with author info
    const messages = await db
      .select({
        id: discussionMessages.id,
        discussionId: discussionMessages.discussionId,
        content: discussionMessages.content,
        userId: discussionMessages.userId,
        createdAt: discussionMessages.createdAt,
        updatedAt: discussionMessages.updatedAt,
        author: {
          id: users.id,
          name: users.name,
          avatarUrl: users.avatarUrl,
        },
      })
      .from(discussionMessages)
      .leftJoin(users, eq(users.id, discussionMessages.userId))
      .where(and(
        eq(discussionMessages.discussionId, id),
        isNull(discussionMessages.deletedAt)
      ))
      .orderBy(asc(discussionMessages.createdAt))
      .limit(limit)
      .offset(offset)
      .all();

    // Get total count for pagination
    const totalQuery = await db
      .select({ count: count() })
      .from(discussionMessages)
      .where(and(
        eq(discussionMessages.discussionId, id),
        isNull(discussionMessages.deletedAt)
      ))
      .get();

    return jsonResponse({
      messages,
      pagination: {
        total: totalQuery?.count || 0,
        limit,
        offset,
      },
    });
  } catch (error) {
    console.error('Failed to fetch messages:', error);
    return jsonResponse({ error: 'Failed to fetch messages.' }, { status: 500 });
  }
}

// POST /api/discussions/:id/messages - Add a message to a discussion
export async function action({ request, context, params }: any) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const env = context.env ?? context.cloudflare?.env ?? {};
  const user = await requireAuth(request, { env });

  if (!hasDatabase(env)) {
    return jsonResponse({ error: 'Database not configured.' }, { status: 503 });
  }

  const db = getDb(env);
  const { id } = params;

  if (!id) {
    return jsonResponse({ error: 'Discussion ID is required.' }, { status: 400 });
  }

  const body = await parseRequestPayload(request);

  try {
    const payload = validateDiscussionMessagePayload(body);
    await syncUserRecord(env, user);

    // Verify discussion exists and is not deleted
    const discussion = await db
      .select()
      .from(discussions)
      .where(and(
        eq(discussions.id, id),
        isNull(discussions.deletedAt)
      ))
      .get();

    if (!discussion) {
      return jsonResponse({ error: 'Discussion not found.' }, { status: 404 });
    }

    const messageId = crypto.randomUUID();
    const now = Date.now();

    // Create the message
    await db.insert(discussionMessages).values({
      id: messageId,
      discussionId: id,
      content: payload.content,
      userId: user.id,
      createdAt: now,
      updatedAt: now,
    });

    // Update discussion's updatedAt timestamp
    await db
      .update(discussions)
      .set({ updatedAt: now })
      .where(eq(discussions.id, id));

    // Get the created message with author info
    const created = await db
      .select({
        id: discussionMessages.id,
        discussionId: discussionMessages.discussionId,
        content: discussionMessages.content,
        userId: discussionMessages.userId,
        createdAt: discussionMessages.createdAt,
        updatedAt: discussionMessages.updatedAt,
        author: {
          id: users.id,
          name: users.name,
          avatarUrl: users.avatarUrl,
        },
      })
      .from(discussionMessages)
      .leftJoin(users, eq(users.id, discussionMessages.userId))
      .where(eq(discussionMessages.id, messageId))
      .get();

    // Publish real-time event with discussion's docPath
    await publishDiscussionEvent(context, discussion.docPath, 'message', created, user.id);

    return jsonResponse({ message: created }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return jsonResponse({ error: error.message }, { status: 400 });
    }

    console.error('Failed to add message:', error);
    return jsonResponse({ error: 'Failed to add message.' }, { status: 500 });
  }
}
import { and, eq, isNull } from 'drizzle-orm';
import { requireAuth } from '~/lib/auth/session.server';
import { getDb, hasDatabase } from '~/lib/db/client.server';
import { discussions, discussionMessages } from '~/lib/db/schema';
import { jsonResponse } from '~/lib/utils/responses';

// DELETE /api/discussions/:id/messages/:messageId - Delete a specific message
export async function action({ request, context, params }: any) {
  if (request.method !== 'DELETE') {
    return new Response('Method not allowed', { status: 405 });
  }

  const env = context.env ?? context.cloudflare?.env ?? {};
  const user = await requireAuth(request, { env });

  if (!hasDatabase(env)) {
    return jsonResponse({ error: 'Database not configured.' }, { status: 503 });
  }

  const db = getDb(env);
  const { id: discussionId, messageId } = params;

  if (!discussionId || !messageId) {
    return jsonResponse({ error: 'Discussion ID and Message ID are required.' }, { status: 400 });
  }

  // Verify discussion exists
  const discussion = await db
    .select()
    .from(discussions)
    .where(and(
      eq(discussions.id, discussionId),
      isNull(discussions.deletedAt)
    ))
    .get();

  if (!discussion) {
    return jsonResponse({ error: 'Discussion not found.' }, { status: 404 });
  }

  // Check if message exists and user has permission
  const message = await db
    .select()
    .from(discussionMessages)
    .where(and(
      eq(discussionMessages.id, messageId),
      eq(discussionMessages.discussionId, discussionId),
      isNull(discussionMessages.deletedAt)
    ))
    .get();

  if (!message) {
    return jsonResponse({ error: 'Message not found.' }, { status: 404 });
  }

  // Only owner or admin can delete
  if (message.userId !== user.id && user.role !== 'admin') {
    return jsonResponse({ error: 'You do not have permission to delete this message.' }, { status: 403 });
  }

  // Soft delete the message
  await db
    .update(discussionMessages)
    .set({
      deletedAt: Date.now(),
      updatedAt: Date.now(),
    })
    .where(eq(discussionMessages.id, messageId));

  return jsonResponse({ success: true });
}
/**
 * SSE endpoint for real-time event streaming
 */

import type { LoaderFunctionArgs } from 'react-router';
import { data as json } from 'react-router';
import { getSessionId } from '~/lib/auth/session.server';
import { subscribeToEvents, publishPresenceEvent } from '~/lib/events/publisher.server';

export async function loader({ request, context }: LoaderFunctionArgs) {
  // Check authentication
  const sessionId = getSessionId(request);
  if (!sessionId) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const docPath = url.searchParams.get('docPath');

  if (!docPath) {
    return json({ error: 'docPath parameter required' }, { status: 400 });
  }

  // Check if user has access to this document
  // For now, we'll allow all authenticated users - in production, add proper authorization
  const hasAccess = true; // TODO: Implement document access control

  if (!hasAccess) {
    return json({ error: 'Access denied' }, { status: 403 });
  }

  // Publish user online presence event
  await publishPresenceEvent(context, docPath, sessionId, 'online');

  // Subscribe to events for this document
  const response = await subscribeToEvents(context, docPath, sessionId);

  // Add CORS headers if needed
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Credentials', 'true');

  // Clean up: publish offline event when connection closes
  // Note: This is best-effort, may not always fire
  request.signal.addEventListener('abort', async () => {
    try {
      await publishPresenceEvent(context, docPath, sessionId, 'offline');
    } catch (error) {
      console.error('Error publishing offline event:', error);
    }
  });

  return new Response(response.body, {
    status: response.status,
    headers
  });
}
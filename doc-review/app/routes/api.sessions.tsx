import { requireAuth } from '~/lib/auth/session.server';
import { createSession, listSessions } from '~/lib/db/sessions.server';
import { syncUserRecord } from '~/lib/db/users.server';
import { hasDatabase } from '~/lib/db/client.server';
import { jsonResponse } from '~/lib/utils/responses';
import { parseRequestPayload } from '~/lib/utils/request.server';
import { validateSessionPayload, ValidationError } from '~/lib/collaboration/validators';

export async function loader({ request, context }: any) {
  const env = context.env ?? context.cloudflare?.env ?? {};
  await requireAuth(request, { env });

  const url = new URL(request.url);
  const docPath = url.searchParams.get('docPath') ?? undefined;

  if (!hasDatabase(env)) {
    return jsonResponse({ sessions: [] });
  }

  const sessions = await listSessions(env, docPath);
  return jsonResponse({ sessions });
}

export async function action({ request, context }: any) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const env = context.env ?? context.cloudflare?.env ?? {};
  const user = await requireAuth(request, { env });

  if (!hasDatabase(env)) {
    return jsonResponse({ error: 'Database not configured.' }, { status: 503 });
  }

  const payload = await parseRequestPayload(request);

  try {
    const input = validateSessionPayload(payload);
    await syncUserRecord(env, user);
    const session = await createSession(env, user, input);
    return jsonResponse({ session, ok: true }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return jsonResponse({ error: error.message }, { status: 400 });
    }

    console.error(error);
    return jsonResponse({ error: 'Failed to create review session.' }, { status: 500 });
  }
}

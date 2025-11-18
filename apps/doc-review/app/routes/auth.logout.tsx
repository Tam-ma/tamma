import { redirect } from 'react-router';
import { createOAuthService } from '~/lib/auth/oauth.server';
import { getSessionId, resolveEnv } from '~/lib/auth/session.server';

export async function loader({ request, context }: any) {
  const env = resolveEnv(context);
  const provider = env.GIT_PROVIDER || 'github';
  const oauth = createOAuthService(provider, env);

  const sessionId = getSessionId(request);
  if (sessionId) {
    await oauth.deleteSession(sessionId);
  }

  const headers = new Headers();
  headers.append('Set-Cookie', 'session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');

  return redirect('/', { headers });
}

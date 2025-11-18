import { redirect } from 'react-router';
import type { LoaderFunctionArgs } from 'react-router';
import { createOAuthService } from '~/lib/auth/oauth.server';
import { resolveEnv } from '~/lib/auth/session.server';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = resolveEnv(context);
  const provider = env.GIT_PROVIDER || 'github';

  // If no credentials configured, return error message
  if (!env.GITHUB_CLIENT_ID && !env.GITLAB_CLIENT_ID) {
    return new Response('Authentication not configured. Please set up OAuth credentials.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  const oauth = createOAuthService(provider, env);

  const url = new URL(request.url);
  const redirectUri = `${url.origin}/auth/callback`;
  const state = crypto.randomUUID();

  // Store state in KV for CSRF protection (skip if KV not available)
  if (env.CACHE) {
    await env.CACHE.put(
      `oauth_state:${state}`,
      'valid',
      { expirationTtl: 600 } // 10 minutes
    );
  }

  const authUrl = oauth.getAuthorizationUrl(state, redirectUri);

  return redirect(authUrl);
}

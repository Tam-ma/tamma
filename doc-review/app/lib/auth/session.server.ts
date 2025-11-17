import { redirect } from 'react-router';
import { createOAuthService } from './oauth.server';
import type { OAuthUser } from './oauth.server';

export function getSessionId(request: Request): string | null {
  const cookie = request.headers.get('Cookie');
  if (!cookie) return null;

  const match = cookie.match(/session=([^;]+)/);
  return match ? match[1] : null;
}

export function resolveEnv(context: { env?: Record<string, unknown>; cloudflare?: { env?: Record<string, unknown> } }) {
  const env = context?.env ?? context?.cloudflare?.env;

  // In development mode without Cloudflare bindings, return empty object with defaults
  if (!env) {
    console.warn('Warning: Cloudflare env bindings not found. Auth features will be disabled.');
    return {
      GIT_PROVIDER: 'github',
      GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID || '',
      GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET || '',
      CACHE: null as any,
    };
  }

  return env as { CACHE: KVNamespace; [key: string]: any };
}

export async function requireAuth(
  request: Request,
  context: { env?: Record<string, unknown>; cloudflare?: { env?: Record<string, unknown> } }
): Promise<OAuthUser> {
  const sessionId = getSessionId(request);

  if (!sessionId) {
    throw redirect('/auth/login');
  }

  const env = resolveEnv(context);
  const provider = env.GIT_PROVIDER || 'github';
  const oauth = createOAuthService(provider, env);

  const user = await oauth.getSession(sessionId);

  if (!user) {
    throw redirect('/auth/login');
  }

  // Refresh session on each request
  await oauth.refreshSession(sessionId);

  return user;
}

export async function getUser(
  request: Request,
  context: { env?: Record<string, unknown>; cloudflare?: { env?: Record<string, unknown> } }
): Promise<OAuthUser | null> {
  const sessionId = getSessionId(request);

  if (!sessionId) return null;

  const env = resolveEnv(context);
  const provider = env.GIT_PROVIDER || 'github';
  const oauth = createOAuthService(provider, env);

  return await oauth.getSession(sessionId);
}

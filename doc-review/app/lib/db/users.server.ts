import { eq } from 'drizzle-orm';
import type { OAuthUser } from '~/lib/auth/oauth.server';
import { getDb, hasDatabase } from './client.server';
import { users } from './schema';

export async function syncUserRecord(env: { DB?: D1Database }, user: OAuthUser) {
  if (!hasDatabase(env)) {
    return null;
  }

  const db = getDb(env);
  const existing = await db.select().from(users).where(eq(users.id, user.id)).get();

  const now = Date.now();

  if (existing) {
    await db
      .update(users)
      .set({
        email: user.email ?? existing.email,
        name: user.name ?? existing.name,
        avatarUrl: user.avatarUrl ?? existing.avatarUrl,
        updatedAt: now,
      })
      .where(eq(users.id, user.id));

    return existing;
  }

  await db.insert(users).values({
    id: user.id,
    email: user.email ?? '',
    name: user.name ?? user.username,
    avatarUrl: user.avatarUrl,
    role: 'reviewer',
    createdAt: now,
    updatedAt: now,
  });

  return user;
}

export async function getUserById(env: { DB?: D1Database }, userId: string) {
  if (!hasDatabase(env)) {
    return null;
  }

  const db = getDb(env);
  return await db.select().from(users).where(eq(users.id, userId)).get();
}

export async function getAllUsers(env: { DB?: D1Database }) {
  if (!hasDatabase(env)) {
    return [];
  }

  const db = getDb(env);
  return await db.select().from(users).all();
}

export async function updateUserRole(
  env: { DB?: D1Database },
  userId: string,
  role: string
) {
  if (!hasDatabase(env)) {
    return null;
  }

  const db = getDb(env);
  const now = Date.now();

  await db
    .update(users)
    .set({
      role,
      updatedAt: now,
    })
    .where(eq(users.id, userId));

  return await getUserById(env, userId);
}

import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

export type Database = ReturnType<typeof drizzle>;

export function getDb(env: { DB?: D1Database }) {
  if (!env?.DB) {
    throw new Error('Database binding "DB" is not configured.');
  }

  return drizzle(env.DB, { schema });
}

export function hasDatabase(env: { DB?: D1Database }): env is { DB: D1Database } {
  return Boolean(env?.DB);
}

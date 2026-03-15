/**
 * Simple SQL migration runner for Tamma.
 * Reads .sql files from database/migrations/ in order and executes them.
 * Tracks applied migrations in a `schema_migrations` table.
 *
 * Usage: npx tsx database/migrate.ts
 * Requires: DATABASE_URL environment variable
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

async function ensureMigrationsTable(client: pg.Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(client: pg.Client): Promise<Set<string>> {
  const result = await client.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name');
  return new Set(result.rows.map((r) => r.name));
}

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await ensureMigrationsTable(client);
    const applied = await getAppliedMigrations(client);

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    let ran = 0;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`  skip: ${file} (already applied)`);
        continue;
      }

      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
      console.log(`  apply: ${file}`);

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        ran++;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    if (ran === 0) {
      console.log('All migrations already applied.');
    } else {
      console.log(`Applied ${ran} migration(s).`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error('Migration failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});

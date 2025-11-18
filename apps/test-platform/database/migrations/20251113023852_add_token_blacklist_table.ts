import { Knex } from 'knex';

/**
 * Migration: add_token_blacklist_table
 *
 * Description: Create token_blacklist table for revoked JWT tokens
 *
 * Breaking Changes: None
 *
 * Rollback: This migration can be safely rolled back
 */

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('token_blacklist', (table) => {
    // Primary key - the JWT token ID
    table.string('token_id', 255).primary();

    // User who owned the token (optional, for audit purposes)
    table.uuid('user_id');
    table.foreign('user_id').references('id').inTable('users').onDelete('CASCADE');

    // Blacklist metadata
    table.timestamp('blacklisted_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('expires_at'); // When the token would naturally expire
    table.string('reason', 255); // Why the token was blacklisted
    table.string('ip_address', 45); // IP address that requested the revocation

    // Indexes for performance
    table.index('blacklisted_at');
    table.index('expires_at');
    table.index('user_id');
  });

  // Add trigger to auto-delete expired tokens
  await knex.raw(`
    CREATE OR REPLACE FUNCTION cleanup_expired_blacklist_tokens()
    RETURNS trigger AS $$
    BEGIN
      DELETE FROM token_blacklist WHERE expires_at < NOW();
      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE TRIGGER cleanup_expired_blacklist_tokens_trigger
    AFTER INSERT ON token_blacklist
    EXECUTE FUNCTION cleanup_expired_blacklist_tokens();
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Drop trigger and function
  await knex.raw('DROP TRIGGER IF EXISTS cleanup_expired_blacklist_tokens_trigger ON token_blacklist');
  await knex.raw('DROP FUNCTION IF EXISTS cleanup_expired_blacklist_tokens()');

  // Drop table
  await knex.schema.dropTableIfExists('token_blacklist');
}
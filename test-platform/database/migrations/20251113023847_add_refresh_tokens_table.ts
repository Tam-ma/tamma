import { Knex } from 'knex';

/**
 * Migration: add_refresh_tokens_table
 *
 * Description: Create refresh_tokens table for JWT token rotation and session management
 *
 * Breaking Changes: None
 *
 * Rollback: This migration can be safely rolled back
 */

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('refresh_tokens', (table) => {
    // Primary key
    table.string('id', 255).primary();

    // Foreign key to users
    table.uuid('user_id').notNullable();
    table.foreign('user_id').references('id').inTable('users').onDelete('CASCADE');

    // Token details
    table.string('token_hash', 255).notNullable();
    table.timestamp('expires_at').notNullable();

    // Session tracking
    table.string('device_info', 255);
    table.string('ip_address', 45); // IPv6 support
    table.timestamp('last_used_at');

    // Revocation tracking
    table.timestamp('revoked_at');
    table.string('revoked_reason', 255);

    // Timestamps
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    // Indexes for performance
    table.index('user_id');
    table.index('expires_at');
    table.index('revoked_at');
    table.index(['user_id', 'revoked_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('refresh_tokens');
}
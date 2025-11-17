import { Knex } from 'knex';

/**
 * Migration: add_auth_fields_to_users
 *
 * Description: Add authentication tracking fields to users table
 *
 * Breaking Changes: None
 *
 * Rollback: This migration can be safely rolled back
 */

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (table) => {
    // Password management (only new columns not in initial migration)
    table.timestamp('password_changed_at');
    table.boolean('must_change_password').defaultTo(false);

    // Add index for password_changed_at
    table.index('password_changed_at');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (table) => {
    // Drop index
    table.dropIndex('password_changed_at');

    // Drop columns
    table.dropColumn('password_changed_at');
    table.dropColumn('must_change_password');
  });
}
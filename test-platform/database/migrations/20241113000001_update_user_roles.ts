import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // First, we need to update the existing role column to support the new role values
  // We'll need to drop the constraint, update existing values, and recreate with new enum

  await knex.schema.alterTable('user_organizations', (table) => {
    // Drop the old enum constraint
    table.dropColumn('role');
  });

  await knex.schema.alterTable('user_organizations', (table) => {
    // Add the role column back with expanded enum values
    table.enum('role', [
      'super_admin',  // System-level administrator
      'owner',        // Organization owner
      'admin',        // Organization admin
      'member',       // Organization member
      'viewer'        // Organization viewer (read-only)
    ]).defaultTo('member');
  });

  // Update existing roles to match new hierarchy
  // Previous 'owner' stays as 'owner'
  // Previous 'admin' stays as 'admin'
  // Previous 'member' stays as 'member'

  // Add a system_role column to users table for super_admin designation
  await knex.schema.alterTable('users', (table) => {
    table.enum('system_role', ['user', 'super_admin']).defaultTo('user');
    table.index(['system_role']);
  });

  // Add additional permission fields
  await knex.schema.alterTable('user_organizations', (table) => {
    // Change permissions column type to ensure it's JSONB for better performance
    table.dropColumn('permissions');
  });

  await knex.schema.alterTable('user_organizations', (table) => {
    // Add permissions as array of strings
    table.specificType('permissions', 'text[]').defaultTo('{}');

    // Add cached permissions for performance
    table.jsonb('cached_permissions').nullable();
    table.timestamp('cached_permissions_at').nullable();
  });

  // Create indexes for better query performance
  await knex.schema.alterTable('user_organizations', (table) => {
    table.index(['user_id', 'organization_id', 'status']);
    table.index(['organization_id', 'role']);
  });
}

export async function down(knex: Knex): Promise<void> {
  // Remove the system_role from users table
  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('system_role');
  });

  // Remove cached permissions fields
  await knex.schema.alterTable('user_organizations', (table) => {
    table.dropColumn('cached_permissions');
    table.dropColumn('cached_permissions_at');
  });

  // Revert role column to original enum values
  await knex.schema.alterTable('user_organizations', (table) => {
    table.dropColumn('role');
    table.dropColumn('permissions');
  });

  await knex.schema.alterTable('user_organizations', (table) => {
    table.enum('role', ['member', 'admin', 'owner']).defaultTo('member');
    table.jsonb('permissions').defaultTo('{}');
  });

  // Drop indexes
  await knex.raw('DROP INDEX IF EXISTS user_organizations_user_id_organization_id_status_index');
  await knex.raw('DROP INDEX IF EXISTS user_organizations_organization_id_role_index');
}
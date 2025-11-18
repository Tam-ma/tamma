import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Create email_verification_tokens table
  await knex.schema.createTable('email_verification_tokens', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('token', 128).notNullable().unique();
    table.timestamp('expires_at').notNullable();
    table.timestamp('used_at').nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    // Indexes for performance
    table.index(['token', 'expires_at']);
    table.index(['user_id']);
    table.index(['expires_at']);
  });

  // Add email verification columns to users table if they don't exist
  const hasEmailVerified = await knex.schema.hasColumn('users', 'email_verified');
  const hasEmailVerifiedAt = await knex.schema.hasColumn('users', 'email_verified_at');

  if (!hasEmailVerified || !hasEmailVerifiedAt) {
    await knex.schema.alterTable('users', (table) => {
      if (!hasEmailVerified) {
        table.boolean('email_verified').notNullable().defaultTo(false);
      }
      if (!hasEmailVerifiedAt) {
        table.timestamp('email_verified_at').nullable();
      }
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('email_verification_tokens');

  // Remove email verification columns from users table
  const hasEmailVerified = await knex.schema.hasColumn('users', 'email_verified');
  const hasEmailVerifiedAt = await knex.schema.hasColumn('users', 'email_verified_at');

  if (hasEmailVerified || hasEmailVerifiedAt) {
    await knex.schema.alterTable('users', (table) => {
      if (hasEmailVerified) {
        table.dropColumn('email_verified');
      }
      if (hasEmailVerifiedAt) {
        table.dropColumn('email_verified_at');
      }
    });
  }
}
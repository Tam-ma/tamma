import { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  // Create password_reset_tokens table
  await knex.schema.createTable('password_reset_tokens', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    table.uuid('user_id').notNullable().index()
    table.string('token', 255).notNullable().unique().index()
    table.timestamp('expires_at').notNullable().index()
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now())
    table.timestamp('used_at').nullable()
    table.string('ip_address', 45).nullable()
    table.text('user_agent').nullable()
    table.string('used_ip_address', 45).nullable()
    table.text('used_user_agent').nullable()
    table.timestamp('updated_at').nullable()

    // Foreign key
    table.foreign('user_id').references('id').inTable('users').onDelete('CASCADE')

    // Indexes for performance
    table.index(['user_id', 'used_at', 'expires_at'])
    table.index(['token', 'used_at', 'expires_at'])
  })

  // Add password reset rate limiting table
  await knex.schema.createTable('password_reset_attempts', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    table.string('email', 255).notNullable().index()
    table.string('ip_address', 45).notNullable().index()
    table.timestamp('attempted_at').notNullable().defaultTo(knex.fn.now())
    table.boolean('success').defaultTo(false)
    table.text('user_agent').nullable()

    // Index for rate limiting queries
    table.index(['email', 'attempted_at'])
    table.index(['ip_address', 'attempted_at'])
  })

  // Add password history table for security
  await knex.schema.createTable('password_history', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    table.uuid('user_id').notNullable().index()
    table.string('password_hash').notNullable()
    table.string('password_salt').notNullable()
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now())
    table.string('changed_by_ip', 45).nullable()
    table.text('changed_by_user_agent').nullable()
    table.string('change_reason').nullable() // 'reset', 'change', 'admin_reset', etc.

    // Foreign key
    table.foreign('user_id').references('id').inTable('users').onDelete('CASCADE')

    // Index for history queries
    table.index(['user_id', 'created_at'])
  })
}

export async function down(knex: Knex): Promise<void> {
  // Drop tables in reverse order to respect foreign key constraints
  await knex.schema.dropTableIfExists('password_history')
  await knex.schema.dropTableIfExists('password_reset_attempts')
  await knex.schema.dropTableIfExists('password_reset_tokens')
}
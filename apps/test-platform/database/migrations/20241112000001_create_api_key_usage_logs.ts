import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('api_key_usage_logs', (table) => {
    // Primary key
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

    // Foreign key to api_keys table
    table.uuid('api_key_id').notNullable().references('id').inTable('api_keys').onDelete('CASCADE');

    // Request information
    table.string('endpoint', 500).notNullable();
    table.string('method', 10).nullable(); // GET, POST, PUT, DELETE, etc.
    table.string('path', 1000).nullable(); // Full request path
    table.integer('status_code').notNullable();
    table.float('response_time').notNullable(); // in milliseconds

    // Client information
    table.string('ip_address', 45).nullable();
    table.string('user_agent', 500).nullable();

    // Additional metadata
    table.jsonb('request_headers').nullable(); // Optional: store relevant headers
    table.jsonb('response_metadata').nullable(); // Optional: store response metadata

    // Timestamp
    table.timestamp('created_at').defaultTo(knex.fn.now());

    // Indexes for performance
    table.index(['api_key_id', 'created_at']); // For time-based queries per key
    table.index(['endpoint', 'created_at']); // For endpoint analytics
    table.index(['status_code', 'created_at']); // For error rate analysis
    table.index(['created_at']); // For time-based queries
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTableIfExists('api_key_usage_logs');
}
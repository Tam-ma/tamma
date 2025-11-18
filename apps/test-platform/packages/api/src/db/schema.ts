import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

/**
 * Users table - stores user authentication and profile information
 */
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  fullName: text('full_name'),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
})

/**
 * Email verification tokens table
 */
export const verificationTokens = sqliteTable('verification_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
})

/**
 * Password reset tokens table
 */
export const passwordResetTokens = sqliteTable('password_reset_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
})

/**
 * API Keys table - stores user API keys for programmatic access
 */
export const apiKeys = sqliteTable('api_keys', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  keyHash: text('key_hash').notNull().unique(),
  keyPrefix: text('key_prefix').notNull(),
  scopes: text('scopes').notNull(), // JSON array of strings
  rateLimit: integer('rate_limit').notNull().default(1000),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
  status: text('status').notNull().default('active'), // active | inactive | expired | revoked
  ipWhitelist: text('ip_whitelist'), // JSON array of IP addresses
})

/**
 * API Key Usage table - stores usage statistics for API keys
 */
export const apiKeyUsage = sqliteTable('api_key_usage', {
  id: text('id').primaryKey(),
  apiKeyId: text('api_key_id').notNull().references(() => apiKeys.id, { onDelete: 'cascade' }),
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  endpoint: text('endpoint').notNull(),
  method: text('method').notNull(),
  statusCode: integer('status_code').notNull(),
  responseTime: integer('response_time'), // milliseconds
  ipAddress: text('ip_address'),
})

// Type exports for TypeScript
export type User = typeof users.$inferSelect
export type InsertUser = typeof users.$inferInsert

export type VerificationToken = typeof verificationTokens.$inferSelect
export type InsertVerificationToken = typeof verificationTokens.$inferInsert

export type PasswordResetToken = typeof passwordResetTokens.$inferSelect
export type InsertPasswordResetToken = typeof passwordResetTokens.$inferInsert

export type APIKey = typeof apiKeys.$inferSelect
export type InsertAPIKey = typeof apiKeys.$inferInsert

export type APIKeyUsage = typeof apiKeyUsage.$inferSelect
export type InsertAPIKeyUsage = typeof apiKeyUsage.$inferInsert

/**
 * Test Bank table - Pre-built tasks with ground truth solutions
 */
export const testBank = sqliteTable('test_bank', {
  id: text('id').primaryKey(),

  // Task metadata
  language: text('language').notNull(), // 'typescript', 'python', 'csharp', 'java', 'go', 'ruby', 'rust'
  scenario: text('scenario').notNull(), // 'code-generation', 'test-generation', etc.
  difficulty: text('difficulty').notNull(), // 'easy', 'medium', 'hard' (base difficulty for general agent)

  // Task content
  title: text('title').notNull(),
  description: text('description').notNull(),
  prompt: text('prompt').notNull(),
  starterCode: text('starter_code'),

  // Ground truth
  solution: text('solution').notNull(),
  testSuite: text('test_suite').notNull(), // JSON string
  expectedMetrics: text('expected_metrics'), // JSON string

  // Role-based evaluation
  primaryRole: text('primary_role').notNull().default('developer'), // Primary role this task is designed for
  roleEvaluations: text('role_evaluations'), // JSON array of RoleEvaluation objects

  // Metadata
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  createdBy: text('created_by'),
  tags: text('tags'), // JSON array of strings
  source: text('source'),
})

/**
 * Benchmark Runs table - Groups results from same monthly run
 */
export const benchmarkRuns = sqliteTable('benchmark_runs', {
  id: text('id').primaryKey(),
  startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  status: text('status').notNull().default('running'), // 'running', 'completed', 'failed'
  totalModels: integer('total_models').notNull(),
  totalTasks: integer('total_tasks').notNull(),
  metadata: text('metadata'), // JSON string
})

/**
 * Benchmark Results table - Historical results from benchmark runs
 */
export const benchmarkResults = sqliteTable('benchmark_results', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => benchmarkRuns.id, { onDelete: 'cascade' }),

  // Model info (captured at runtime)
  modelId: text('model_id').notNull(),
  modelProvider: text('model_provider'),
  modelName: text('model_name'),

  // Task reference
  taskId: text('task_id').notNull().references(() => testBank.id),

  // Model response
  generatedCode: text('generated_code'),
  rawResponse: text('raw_response'),

  // Automated metrics
  compiles: integer('compiles', { mode: 'boolean' }),
  testPassRate: integer('test_pass_rate'), // 0-100
  codeQualityScore: integer('code_quality_score'), // 0-1000 (0.00-10.00 * 100)
  latencyMs: integer('latency_ms'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  costUsd: integer('cost_usd'), // in micro-dollars (multiply by 1000000)

  // Multi-judge scores (0-1000, representing 0.00-10.00 * 100)
  staffScore: integer('staff_score'),
  userScore: integer('user_score'),
  selfReviewScore: integer('self_review_score'),
  teamReviewScore: integer('team_review_score'),

  // Final score (0-1000)
  finalScore: integer('final_score'),

  // Timestamps
  startedAt: integer('started_at', { mode: 'timestamp' }),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
})

/**
 * Staff Reviews table - Expert human evaluations
 */
export const staffReviews = sqliteTable('staff_reviews', {
  id: text('id').primaryKey(),
  reviewerId: text('reviewer_id').notNull().references(() => users.id),
  benchmarkResultId: text('benchmark_result_id').notNull().references(() => benchmarkResults.id, { onDelete: 'cascade' }),

  // Evaluation criteria (0-1000 each, representing 0.00-10.00 * 100)
  correctness: integer('correctness').notNull(),
  codeQuality: integer('code_quality').notNull(),
  bestPractices: integer('best_practices').notNull(),
  efficiency: integer('efficiency').notNull(),

  overallScore: integer('overall_score').notNull(), // 0-1000
  notes: text('notes'),
  reviewedAt: integer('reviewed_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
})

/**
 * User Reviews table - Community feedback
 */
export const userReviews = sqliteTable('user_reviews', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  benchmarkResultId: text('benchmark_result_id').notNull().references(() => benchmarkResults.id, { onDelete: 'cascade' }),

  vote: text('vote').notNull(), // 'upvote' | 'downvote'
  comment: text('comment'),

  reviewedAt: integer('reviewed_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
})

/**
 * Judge Reviews table - LLM agent team evaluations
 */
export const judgeReviews = sqliteTable('judge_reviews', {
  id: text('id').primaryKey(),
  benchmarkResultId: text('benchmark_result_id').notNull().references(() => benchmarkResults.id, { onDelete: 'cascade' }),

  judgeModel: text('judge_model').notNull(), // e.g., 'anthropic/claude-opus-4.1'
  judgeRole: text('judge_role').notNull(), // e.g., 'code-quality-expert'
  score: integer('score').notNull(), // 0-1000
  weight: integer('weight').notNull(), // 0-1000 (representing 0.000-1.000 * 1000)
  reasoning: text('reasoning'),
  criticalIssues: text('critical_issues'), // JSON array
  suggestions: text('suggestions'), // JSON array

  reviewedAt: integer('reviewed_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
})

// Type exports for TypeScript
export type TestBankTask = typeof testBank.$inferSelect
export type InsertTestBankTask = typeof testBank.$inferInsert

export type BenchmarkRun = typeof benchmarkRuns.$inferSelect
export type InsertBenchmarkRun = typeof benchmarkRuns.$inferInsert

export type BenchmarkResult = typeof benchmarkResults.$inferSelect
export type InsertBenchmarkResult = typeof benchmarkResults.$inferInsert

export type StaffReview = typeof staffReviews.$inferSelect
export type InsertStaffReview = typeof staffReviews.$inferInsert

export type UserReview = typeof userReviews.$inferSelect
export type InsertUserReview = typeof userReviews.$inferInsert

export type JudgeReview = typeof judgeReviews.$inferSelect
export type InsertJudgeReview = typeof judgeReviews.$inferInsert

/**
 * LLM Models table - Global catalog of available AI models
 */
export const llmModels = sqliteTable('llm_models', {
  id: text('id').primaryKey(), // e.g., 'anthropic/claude-3-5-sonnet-20241022'

  // Provider info
  provider: text('provider').notNull(), // 'anthropic', 'openai', 'google', 'mistral', 'cohere', etc.
  modelName: text('model_name').notNull(), // 'claude-3-5-sonnet-20241022', 'gpt-4-turbo', etc.
  displayName: text('display_name').notNull(), // 'Claude 3.5 Sonnet', 'GPT-4 Turbo', etc.

  // API configuration
  apiEndpoint: text('api_endpoint').notNull(), // Base API URL
  apiVersion: text('api_version'), // API version if applicable

  // Model capabilities
  contextWindow: integer('context_window').notNull(), // Max tokens in context
  maxOutputTokens: integer('max_output_tokens').notNull(), // Max output tokens
  supportsStreaming: integer('supports_streaming', { mode: 'boolean' }).notNull().default(true),
  supportsFunctions: integer('supports_functions', { mode: 'boolean' }).notNull().default(false),
  supportsVision: integer('supports_vision', { mode: 'boolean' }).notNull().default(false),

  // Pricing (in micro-dollars per 1M tokens)
  inputPricePer1M: integer('input_price_per_1m').notNull(), // e.g., 3000000 for $3.00
  outputPricePer1M: integer('output_price_per_1m').notNull(), // e.g., 15000000 for $15.00

  // Model metadata
  releaseDate: integer('release_date', { mode: 'timestamp' }),
  deprecated: integer('deprecated', { mode: 'boolean' }).notNull().default(false),
  deprecationDate: integer('deprecation_date', { mode: 'timestamp' }),
  replacementModelId: text('replacement_model_id'),

  // Performance hints
  recommendedTemperature: integer('recommended_temperature'), // 0-1000 (representing 0.00-1.00 * 1000)
  recommendedTopP: integer('recommended_top_p'), // 0-1000

  // Tags and categorization
  tags: text('tags'), // JSON array: ['fast', 'high-quality', 'cost-effective', 'vision', 'long-context']
  description: text('description'),

  // Status
  status: text('status').notNull().default('active'), // 'active', 'beta', 'deprecated', 'disabled'

  // Timestamps
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
})

/**
 * User Model Configurations table - User-specific API keys and preferences
 */
export const userModelConfigs = sqliteTable('user_model_configs', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  modelId: text('model_id').notNull().references(() => llmModels.id, { onDelete: 'cascade' }),

  // API credentials (encrypted)
  apiKey: text('api_key').notNull(), // Encrypted API key
  apiKeyLastFour: text('api_key_last_four').notNull(), // Last 4 chars for display

  // User preferences (override defaults)
  customTemperature: integer('custom_temperature'), // 0-1000
  customMaxTokens: integer('custom_max_tokens'),
  customSystemPrompt: text('custom_system_prompt'),

  // Usage limits
  monthlyBudgetUsd: integer('monthly_budget_usd'), // in micro-dollars
  dailyRequestLimit: integer('daily_request_limit'),

  // Settings
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  nickname: text('nickname'), // User-friendly name
  notes: text('notes'),

  // Timestamps
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
})

/**
 * Model Usage table - Track API usage per user per model
 */
export const modelUsage = sqliteTable('model_usage', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  userModelConfigId: text('user_model_config_id').references(() => userModelConfigs.id, { onDelete: 'set null' }),
  modelId: text('model_id').notNull().references(() => llmModels.id),

  // Usage data
  requestType: text('request_type').notNull(), // 'benchmark', 'chat', 'completion', etc.
  inputTokens: integer('input_tokens').notNull(),
  outputTokens: integer('output_tokens').notNull(),
  totalTokens: integer('total_tokens').notNull(),

  // Cost calculation
  inputCostUsd: integer('input_cost_usd').notNull(), // in micro-dollars
  outputCostUsd: integer('output_cost_usd').notNull(),
  totalCostUsd: integer('total_cost_usd').notNull(),

  // Performance
  latencyMs: integer('latency_ms'),
  success: integer('success', { mode: 'boolean' }).notNull(),
  errorMessage: text('error_message'),

  // Metadata
  metadata: text('metadata'), // JSON: benchmark ID, task ID, etc.

  // Timestamp
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
})

/**
 * System Configuration table - Platform-level settings
 */
export const systemConfig = sqliteTable('system_config', {
  id: text('id').primaryKey(),

  // System user for benchmarks
  systemUserId: text('system_user_id').references(() => users.id),

  // Default models for various purposes
  defaultBenchmarkModelId: text('default_benchmark_model_id').references(() => llmModels.id),
  defaultJudgeModelId: text('default_judge_model_id').references(() => llmModels.id),

  // Rate limiting
  globalRateLimit: integer('global_rate_limit').notNull().default(10000), // requests per hour
  perUserRateLimit: integer('per_user_rate_limit').notNull().default(1000),

  // Feature flags
  features: text('features'), // JSON object

  // Timestamps
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
})

// Type exports for TypeScript
export type LLMModel = typeof llmModels.$inferSelect
export type InsertLLMModel = typeof llmModels.$inferInsert

export type UserModelConfig = typeof userModelConfigs.$inferSelect
export type InsertUserModelConfig = typeof userModelConfigs.$inferInsert

export type ModelUsage = typeof modelUsage.$inferSelect
export type InsertModelUsage = typeof modelUsage.$inferInsert

export type SystemConfig = typeof systemConfig.$inferSelect
export type InsertSystemConfig = typeof systemConfig.$inferInsert

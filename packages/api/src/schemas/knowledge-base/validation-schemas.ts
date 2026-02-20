/**
 * Knowledge Base Validation Schemas
 *
 * Zod schemas for request/response validation on API endpoints.
 */

import { z } from 'zod';

// === Index Management ===

export const TriggerIndexRequestSchema = z.object({
  fullReindex: z.boolean().optional(),
}).optional();

export const UpdateIndexConfigSchema = z.object({
  includePatterns: z.array(z.string()).optional(),
  excludePatterns: z.array(z.string()).optional(),
  chunkingConfig: z.object({
    maxTokens: z.number().int().positive().optional(),
    overlapTokens: z.number().int().nonnegative().optional(),
    preserveImports: z.boolean().optional(),
    groupRelatedCode: z.boolean().optional(),
  }).optional(),
  embeddingConfig: z.object({
    provider: z.enum(['openai', 'cohere', 'ollama']).optional(),
    model: z.string().optional(),
    batchSize: z.number().int().positive().optional(),
  }).optional(),
  triggerConfig: z.object({
    gitHooks: z.boolean().optional(),
    watchMode: z.boolean().optional(),
    schedule: z.string().nullable().optional(),
  }).optional(),
});

// === Vector Database ===

export const CreateCollectionRequestSchema = z.object({
  name: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  dimensions: z.number().int().positive().optional(),
});

export const VectorSearchRequestSchema = z.object({
  collection: z.string().min(1),
  query: z.string().min(1),
  topK: z.number().int().positive().max(100),
  scoreThreshold: z.number().min(0).max(1).optional(),
  filter: z.record(z.unknown()).optional(),
});

// === RAG Pipeline ===

export const RAGConfigUpdateSchema = z.object({
  sources: z.object({
    vectorDb: z.object({ enabled: z.boolean(), weight: z.number(), topK: z.number().int() }).optional(),
    keyword: z.object({ enabled: z.boolean(), weight: z.number(), topK: z.number().int() }).optional(),
    docs: z.object({ enabled: z.boolean(), weight: z.number(), topK: z.number().int() }).optional(),
    issues: z.object({ enabled: z.boolean(), weight: z.number(), topK: z.number().int() }).optional(),
  }).optional(),
  ranking: z.object({
    fusionMethod: z.enum(['rrf', 'linear', 'learned']).optional(),
    mmrLambda: z.number().min(0).max(1).optional(),
    recencyBoost: z.number().min(0).max(1).optional(),
  }).optional(),
  assembly: z.object({
    maxTokens: z.number().int().positive().optional(),
    format: z.enum(['xml', 'markdown', 'plain']).optional(),
    includeScores: z.boolean().optional(),
  }).optional(),
  caching: z.object({
    enabled: z.boolean().optional(),
    ttlSeconds: z.number().int().positive().optional(),
    maxEntries: z.number().int().positive().optional(),
  }).optional(),
});

export const RAGTestRequestSchema = z.object({
  query: z.string().min(1),
  sources: z.array(z.string()).optional(),
  maxTokens: z.number().int().positive().optional(),
  topK: z.number().int().positive().optional(),
});

// === MCP Servers ===

export const MCPToolInvokeBodySchema = z.object({
  arguments: z.record(z.unknown()).optional(),
});

// === Context Testing ===

export const ContextTestRequestSchema = z.object({
  query: z.string().min(1),
  taskType: z.enum(['analysis', 'planning', 'implementation', 'review', 'testing', 'documentation']),
  maxTokens: z.number().int().positive(),
  sources: z.array(z.enum(['vector_db', 'rag', 'mcp', 'web_search', 'live_api'])).optional(),
  hints: z.object({
    relatedFiles: z.array(z.string()).optional(),
    relatedIssues: z.array(z.number().int()).optional(),
    language: z.string().optional(),
    framework: z.string().optional(),
  }).optional(),
  options: z.object({
    deduplicate: z.boolean().optional(),
    compress: z.boolean().optional(),
    summarize: z.boolean().optional(),
    includeMetadata: z.boolean().optional(),
  }).optional(),
});

export const ContextFeedbackRequestSchema = z.object({
  requestId: z.string().uuid(),
  feedback: z.array(z.object({
    chunkId: z.string(),
    rating: z.enum(['relevant', 'irrelevant', 'partially_relevant']),
    comment: z.string().optional(),
  })),
});

// === Analytics ===

export const AnalyticsPeriodQuerySchema = z.object({
  start: z.string().datetime().optional(),
  end: z.string().datetime().optional(),
});

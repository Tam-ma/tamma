/**
 * Knowledge Base Routes Registration
 *
 * Registers all knowledge base management API routes with Fastify.
 */

import type { FastifyInstance } from 'fastify';
import { IndexManagementService } from '../../services/knowledge-base/IndexManagementService.js';
import { VectorDBManagementService } from '../../services/knowledge-base/VectorDBManagementService.js';
import { RAGManagementService } from '../../services/knowledge-base/RAGManagementService.js';
import { MCPManagementService } from '../../services/knowledge-base/MCPManagementService.js';
import { ContextTestingService } from '../../services/knowledge-base/ContextTestingService.js';
import { AnalyticsService } from '../../services/knowledge-base/AnalyticsService.js';
import { registerIndexRoutes } from './index-routes.js';
import { registerVectorDBRoutes } from './vector-db-routes.js';
import { registerRAGRoutes } from './rag-routes.js';
import { registerMCPRoutes } from './mcp-routes.js';
import { registerContextRoutes } from './context-routes.js';
import { registerAnalyticsRoutes } from './analytics-routes.js';

/** Services container for dependency injection */
export interface KBServices {
  indexService: IndexManagementService;
  vectorDBService: VectorDBManagementService;
  ragService: RAGManagementService;
  mcpService: MCPManagementService;
  contextService: ContextTestingService;
  analyticsService: AnalyticsService;
}

/**
 * Create default service instances.
 * In production these would be injected with real backend connections.
 */
export function createKBServices(): KBServices {
  return {
    indexService: new IndexManagementService(),
    vectorDBService: new VectorDBManagementService(),
    ragService: new RAGManagementService(),
    mcpService: new MCPManagementService(),
    contextService: new ContextTestingService(),
    analyticsService: new AnalyticsService(),
  };
}

/**
 * Register all knowledge base routes under /api/knowledge-base
 */
export async function registerKnowledgeBaseRoutes(
  app: FastifyInstance,
  services?: KBServices,
): Promise<void> {
  const svc = services ?? createKBServices();

  await app.register(
    async (instance) => {
      registerIndexRoutes(instance, svc.indexService);
      registerVectorDBRoutes(instance, svc.vectorDBService);
      registerRAGRoutes(instance, svc.ragService);
      registerMCPRoutes(instance, svc.mcpService);
      registerContextRoutes(instance, svc.contextService);
      registerAnalyticsRoutes(instance, svc.analyticsService);
    },
    { prefix: '/api/knowledge-base' },
  );
}

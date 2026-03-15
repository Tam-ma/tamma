/**
 * Prompt template routes.
 */

import type { FastifyInstance } from 'fastify';
import type { ConfigService } from '../../services/settings/ConfigService.js';

const VALID_ROLES = new Set([
  'defaults',
  'scrum_master',
  'architect',
  'researcher',
  'analyst',
  'planner',
  'implementer',
  'reviewer',
  'tester',
  'documenter',
]);

export function registerPromptsRoutes(app: FastifyInstance, service: ConfigService): void {
  app.get('/prompts', async (_request, reply) => {
    const templates = await service.getPromptTemplates();
    return reply.send(templates);
  });

  app.put('/prompts/:role', async (request, reply) => {
    try {
      const params = request.params as { role: string };

      if (!VALID_ROLES.has(params.role)) {
        return reply.status(400).send({ error: `Unknown role: ${params.role}` });
      }

      const body = request.body as {
        systemPrompt?: string;
        providerPrompts?: Record<string, string>;
      };
      await service.updatePromptTemplate(params.role, body);
      return reply.send({ message: `Prompts updated for role: ${params.role}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update prompts';
      return reply.status(400).send({ error: message });
    }
  });
}

/**
 * Workflow Result Route
 *
 * POST /api/v1/workflows/:id/result — accepts final result for a workflow.
 * Finalizes the workflow instance in the store.
 */

import { z } from 'zod';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { IWorkflowStore } from '../../persistence/workflow-store.js';

const WorkflowResultBodySchema = z.object({
  status: z.enum(['completed', 'failed', 'cancelled']),
  prNumber: z.number().int().positive().optional(),
  error: z.string().optional(),
  duration: z.number().nonnegative(),
});

type WorkflowResultBody = z.infer<typeof WorkflowResultBodySchema>;

export interface WorkflowResultRouteOptions {
  workflowStore: IWorkflowStore;
}

export async function registerWorkflowResultRoute(
  app: FastifyInstance,
  options: WorkflowResultRouteOptions,
): Promise<void> {
  app.post(
    '/api/v1/workflows/:id/result',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: WorkflowResultBody;
      }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;
      const parsed = WorkflowResultBodySchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({
          error: 'Invalid request',
          details: parsed.error.issues,
        });
      }

      const { status, prNumber, error, duration } = parsed.data;

      const existing = await options.workflowStore.getInstance(id);
      if (!existing) {
        return reply.status(404).send({ error: 'Workflow not found' });
      }

      const variables: Record<string, unknown> = {
        ...existing.variables,
        finalStatus: status,
        duration,
      };
      if (prNumber !== undefined) {
        variables['prNumber'] = prNumber;
      }
      if (error !== undefined) {
        variables['error'] = error;
      }

      const updated = await options.workflowStore.updateInstance(id, {
        status,
        variables,
      });

      return reply.send({
        ok: true,
        workflowId: id,
        status: updated?.status ?? status,
        duration,
      });
    },
  );
}

/**
 * Workflow Status Route
 *
 * POST /api/v1/workflows/:id/status — accepts status update for a workflow.
 * Stores the status in the workflow store.
 */

import { z } from 'zod';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { IWorkflowStore } from '../../persistence/workflow-store.js';

const WorkflowStatusBodySchema = z.object({
  status: z.string().min(1),
  step: z.string().min(1),
  progress: z.number().min(0).max(100).optional(),
  message: z.string().optional(),
});

type WorkflowStatusBody = z.infer<typeof WorkflowStatusBodySchema>;

export interface WorkflowStatusRouteOptions {
  workflowStore: IWorkflowStore;
}

export async function registerWorkflowStatusRoute(
  app: FastifyInstance,
  options: WorkflowStatusRouteOptions,
): Promise<void> {
  app.post(
    '/api/v1/workflows/:id/status',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: WorkflowStatusBody;
      }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;
      const parsed = WorkflowStatusBodySchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({
          error: 'Invalid request',
          details: parsed.error.issues,
        });
      }

      const { status, step, progress, message } = parsed.data;

      // Try to update existing instance
      const existing = await options.workflowStore.getInstance(id);
      if (!existing) {
        return reply.status(404).send({ error: 'Workflow not found' });
      }

      const variables: Record<string, unknown> = {
        ...existing.variables,
        lastStep: step,
        lastStatus: status,
      };
      if (progress !== undefined) {
        variables['progress'] = progress;
      }
      if (message !== undefined) {
        variables['message'] = message;
      }

      const updated = await options.workflowStore.updateInstance(id, {
        status,
        currentActivity: step,
        variables,
      });

      return reply.send({
        ok: true,
        workflowId: id,
        status: updated?.status ?? status,
        step,
      });
    },
  );
}

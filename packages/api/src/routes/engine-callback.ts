/**
 * Engine callback routes.
 *
 * Fastify plugin that registers endpoints called by the ELSA workflow engine
 * to delegate agent tasks back to the Tamma node. These are the "callback"
 * half of the ELSA integration: workflows running on the ELSA server POST
 * here when they need an agent to execute a task.
 */

import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { IAgentProvider, AgentTaskConfig } from '@tamma/providers';

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

const ExecuteTaskBodySchema = z.object({
  prompt: z.string().min(1),
  analysisType: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Request / Response shapes
// ---------------------------------------------------------------------------

interface ExecuteTaskBody {
  prompt: string;
  analysisType?: string;
}

interface ExecuteTaskResponse {
  success: boolean;
  output: string;
  costUsd: number;
  durationMs: number;
  error?: string;
}

interface AgentAvailableResponse {
  available: boolean;
}

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

export interface EngineCallbackOptions {
  /** The agent provider to delegate tasks to. */
  agent: IAgentProvider;
  /** Working directory for agent tasks. */
  cwd: string;
  /** Agent model to use (e.g. 'claude-sonnet-4'). */
  model?: string;
  /** Maximum budget per task in USD. */
  maxBudgetUsd?: number;
  /** Optional API key for authenticating callback requests. */
  apiKey?: string;
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

/**
 * Register engine callback routes on a Fastify instance.
 *
 * ```ts
 * await app.register(engineCallbackPlugin, { agent, cwd: '/repo' });
 * ```
 */
export async function engineCallbackPlugin(
  app: FastifyInstance,
  opts: EngineCallbackOptions,
): Promise<void> {
  const { agent, cwd, model, maxBudgetUsd, apiKey } = opts;

  // Authentication preHandler for callback endpoints
  if (apiKey) {
    app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
      const provided = request.headers['x-api-key'] as string | undefined;
      if (!provided) {
        return reply.status(401).send({ error: 'Missing x-api-key header' });
      }
      try {
        const valid =
          provided.length === apiKey.length &&
          timingSafeEqual(Buffer.from(provided), Buffer.from(apiKey));
        if (!valid) {
          return reply.status(401).send({ error: 'Invalid API key' });
        }
      } catch {
        return reply.status(401).send({ error: 'Invalid API key' });
      }
    });
  } else {
    app.log.warn('Engine callback endpoints registered without an API key — requests are unauthenticated');
  }

  // POST /api/engine/execute-task
  app.post(
    '/api/engine/execute-task',
    async (
      request: FastifyRequest<{ Body: ExecuteTaskBody }>,
      reply: FastifyReply,
    ) => {
      const parsed = ExecuteTaskBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.message });
      }
      const { prompt, analysisType } = parsed.data;

      const taskConfig: AgentTaskConfig = {
        prompt,
        cwd,
        ...(model !== undefined ? { model } : {}),
        ...(maxBudgetUsd !== undefined ? { maxBudgetUsd } : {}),
      };

      // Optionally refine prompt with analysis type context
      if (analysisType) {
        taskConfig.prompt = `[Analysis Type: ${analysisType}]\n\n${prompt}`;
      }

      const startMs = Date.now();

      try {
        const result = await agent.executeTask(taskConfig);

        const response: ExecuteTaskResponse = {
          success: result.success,
          output: result.output,
          costUsd: result.costUsd,
          durationMs: result.durationMs,
          ...(result.error ? { error: result.error } : {}),
        };

        return reply.send(response);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const response: ExecuteTaskResponse = {
          success: false,
          output: '',
          costUsd: 0,
          durationMs: Date.now() - startMs,
          error: message,
        };
        return reply.status(500).send(response);
      }
    },
  );

  // GET /api/engine/agent-available
  app.get(
    '/api/engine/agent-available',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const available = await agent.isAvailable();
        const response: AgentAvailableResponse = { available };
        return reply.send(response);
      } catch {
        const response: AgentAvailableResponse = { available: false };
        return reply.send(response);
      }
    },
  );
}

/**
 * LLM Proxy Route
 *
 * POST /api/v1/llm/chat — accepts model/messages/maxTokens/temperature,
 * proxies to configured LLM provider. For now returns a stub response
 * with the correct structure; actual LLM integration comes later.
 */

import { z } from 'zod';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

const ChatRequestSchema = z.object({
  model: z.string().optional(),
  messages: z.array(
    z.object({
      role: z.enum(['system', 'user', 'assistant']),
      content: z.string(),
    }),
  ).min(1),
  maxTokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
});

type ChatRequest = z.infer<typeof ChatRequestSchema>;

export async function registerLlmProxyRoute(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/v1/llm/chat',
    async (
      request: FastifyRequest<{ Body: ChatRequest }>,
      reply: FastifyReply,
    ) => {
      const parsed = ChatRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'Invalid request',
          details: parsed.error.issues,
        });
      }

      const { model, messages, maxTokens, temperature } = parsed.data;

      // Stub response — actual LLM integration will come later
      return reply.send({
        id: `chat_${Date.now()}`,
        model: model ?? 'stub',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant' as const,
              content: '[Stub] LLM proxy is not yet connected to a real provider.',
            },
            finishReason: 'stop',
          },
        ],
        usage: {
          promptTokens: messages.reduce((sum, m) => sum + m.content.length, 0),
          completionTokens: 0,
          totalTokens: messages.reduce((sum, m) => sum + m.content.length, 0),
        },
        meta: {
          maxTokens: maxTokens ?? null,
          temperature: temperature ?? null,
          stub: true,
        },
      });
    },
  );
}

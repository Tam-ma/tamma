import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKMessage, Options } from '@anthropic-ai/claude-agent-sdk';
import type { AgentTaskResult } from '@tamma/shared';
import type {
  IAgentProvider,
  AgentTaskConfig,
  AgentProgressCallback,
  AgentProgressEvent,
} from './agent-types.js';

function emitProgress(
  callback: AgentProgressCallback | undefined,
  event: Omit<AgentProgressEvent, 'timestamp'>,
): void {
  if (callback !== undefined) {
    callback({ ...event, timestamp: Date.now() });
  }
}

export class ClaudeAgentProvider implements IAgentProvider {
  async executeTask(
    config: AgentTaskConfig,
    onProgress?: AgentProgressCallback,
  ): Promise<AgentTaskResult> {
    const start = Date.now();

    try {
      const permMode = config.permissionMode ?? 'bypassPermissions';
      const opts: Options = {
        cwd: config.cwd,
        permissionMode: permMode,
        allowDangerouslySkipPermissions: permMode === 'bypassPermissions',
        systemPrompt: {
          type: 'preset' as const,
          preset: 'claude_code' as const,
        },
        settingSources: ['project' as const],
      };

      if (config.model !== undefined) {
        opts.model = config.model;
      }
      if (config.maxBudgetUsd !== undefined) {
        opts.maxBudgetUsd = config.maxBudgetUsd;
      }
      if (config.allowedTools !== undefined) {
        opts.allowedTools = config.allowedTools;
      }
      if (config.outputFormat !== undefined) {
        opts.outputFormat = config.outputFormat;
      }
      if (config.sessionId !== undefined) {
        opts.resume = config.sessionId;
      }

      const conversation = query({
        prompt: config.prompt,
        options: opts,
      });

      let resultText = '';
      let totalCost = 0;

      for await (const message of conversation) {
        const msg = message as SDKMessage;

        if (msg.type === 'assistant') {
          const content = msg.message.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if ('text' in block && typeof block.text === 'string') {
                emitProgress(onProgress, { type: 'text', message: block.text });
              }
              if ('name' in block && typeof block.name === 'string') {
                emitProgress(onProgress, {
                  type: 'tool_use',
                  message: `Using tool: ${block.name}`,
                });
              }
            }
          }
        }

        if (msg.type === 'result') {
          totalCost = msg.total_cost_usd;
          if (msg.subtype === 'success') {
            resultText = msg.result;
          } else {
            const errors = 'errors' in msg ? (msg.errors as string[]) : [];
            return {
              success: false,
              output: '',
              costUsd: totalCost,
              durationMs: Date.now() - start,
              error: errors.join('; ') || `Agent ended with: ${msg.subtype}`,
            };
          }

          emitProgress(onProgress, {
            type: 'cost_update',
            message: `Total cost: $${totalCost.toFixed(4)}`,
            costSoFar: totalCost,
          });
        }
      }

      return {
        success: true,
        output: resultText,
        costUsd: totalCost,
        durationMs: Date.now() - start,
      };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        output: '',
        costUsd: 0,
        durationMs: Date.now() - start,
        error: errorMessage,
      };
    }
  }

  async isAvailable(): Promise<boolean> {
    return typeof process.env['ANTHROPIC_API_KEY'] === 'string' &&
      process.env['ANTHROPIC_API_KEY'].length > 0;
  }

  async dispose(): Promise<void> {
    // No persistent resources to clean up
  }
}

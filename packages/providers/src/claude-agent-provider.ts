import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentTaskResult } from '@tamma/shared';
import type {
  IAgentProvider,
  AgentTaskConfig,
  AgentProgressCallback,
  AgentProgressEvent,
} from './agent-types.js';
import type { ICLIAgentProvider, CLIAgentCapabilities } from './types.js';

const execFileAsync = promisify(execFile);

/** Errors considered transient and worth retrying. */
function isRetryableError(error: string): boolean {
  const transient = [
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'EPIPE',
    'socket hang up',
    'rate limit',
    'overloaded',
    '529',  // Overloaded
    '503',  // Service Unavailable
  ];
  const lower = error.toLowerCase();
  return transient.some((t) => lower.includes(t.toLowerCase()));
}

function emitProgress(
  callback: AgentProgressCallback | undefined,
  event: Omit<AgentProgressEvent, 'timestamp'>,
): void {
  if (callback !== undefined) {
    callback({ ...event, timestamp: Date.now() });
  }
}

/**
 * Stream-JSON message types emitted by `claude -p --output-format stream-json`.
 * Each line of stdout is a JSON object with a `type` field.
 */
interface StreamMessage {
  type: string;
  [key: string]: unknown;
}

interface StreamResultMessage extends StreamMessage {
  type: 'result';
  subtype: 'success' | 'error_max_turns' | 'error';
  result?: string;
  cost_usd?: number;
  duration_ms?: number;
  session_id?: string;
  is_error?: boolean;
}

interface StreamAssistantMessage extends StreamMessage {
  type: 'assistant';
  message?: {
    content?: Array<{
      type: string;
      text?: string;
      name?: string;
    }>;
  };
}

/**
 * Agent provider that invokes Claude Code CLI in headless mode (`claude -p`).
 *
 * Works with a Claude subscription (Pro/Team/Enterprise) — no separate API key
 * required. The `claude` binary must be installed and authenticated.
 *
 * Uses `--output-format stream-json` for real-time progress and cost tracking.
 */
export class ClaudeAgentProvider implements IAgentProvider, ICLIAgentProvider {
  readonly name = 'claude-code';
  readonly type = 'cli-agent' as const;
  readonly capabilities: CLIAgentCapabilities = {
    fileOperations: true,
    commandExecution: true,
    gitOperations: true,
    browserAutomation: false,
    mcpSupport: true,
    sessionResume: true,
    structuredOutput: true,
    streaming: true,
  };

  async executeTask(
    config: AgentTaskConfig,
    onProgress?: AgentProgressCallback,
  ): Promise<AgentTaskResult> {
    const start = Date.now();
    const maxRetries = 2;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const result = await this.executeOnce(config, onProgress, start);

      if (result.success || attempt >= maxRetries) {
        return result;
      }

      // Only retry transient errors
      if (result.error !== undefined && isRetryableError(result.error)) {
        const delay = 1000 * Math.pow(2, attempt) + Math.random() * 500;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      return result;
    }

    // Should not reach here, but satisfy TypeScript
    return {
      success: false,
      output: '',
      costUsd: 0,
      durationMs: Date.now() - start,
      error: 'Retry logic exhausted',
    };
  }

  private async executeOnce(
    config: AgentTaskConfig,
    onProgress: AgentProgressCallback | undefined,
    start: number,
  ): Promise<AgentTaskResult> {
    try {
      const args = this.buildArgs(config);

      return await new Promise<AgentTaskResult>((resolve) => {
        const child = spawn('claude', args, {
          cwd: config.cwd,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env },
        });

        let resultText = '';
        let totalCost = 0;
        let stdoutBuffer = '';
        let stderrBuffer = '';

        child.stdout.on('data', (data: Buffer) => {
          stdoutBuffer += data.toString();

          // Process complete lines (newline-delimited JSON)
          const lines = stdoutBuffer.split('\n');
          // Keep the last incomplete line in the buffer
          stdoutBuffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.length === 0) continue;

            try {
              const msg = JSON.parse(trimmed) as StreamMessage;
              this.handleStreamMessage(msg, onProgress, (text) => {
                resultText = text;
              }, (cost) => {
                totalCost = cost;
              });
            } catch {
              // Non-JSON output — treat as plain text progress
              emitProgress(onProgress, { type: 'text', message: trimmed });
            }
          }
        });

        child.stderr.on('data', (data: Buffer) => {
          stderrBuffer += data.toString();
        });

        child.on('error', (err) => {
          resolve({
            success: false,
            output: '',
            costUsd: totalCost,
            durationMs: Date.now() - start,
            error: `Failed to spawn claude: ${err.message}`,
          });
        });

        child.on('close', (code) => {
          // Process any remaining buffered output
          if (stdoutBuffer.trim().length > 0) {
            try {
              const msg = JSON.parse(stdoutBuffer.trim()) as StreamMessage;
              this.handleStreamMessage(msg, onProgress, (text) => {
                resultText = text;
              }, (cost) => {
                totalCost = cost;
              });
            } catch {
              // Append as plain text if not JSON
              if (resultText.length === 0) {
                resultText = stdoutBuffer.trim();
              }
            }
          }

          if (code !== 0 && resultText.length === 0) {
            resolve({
              success: false,
              output: '',
              costUsd: totalCost,
              durationMs: Date.now() - start,
              error: stderrBuffer.trim() || `claude exited with code ${code}`,
            });
          } else {
            resolve({
              success: true,
              output: resultText,
              costUsd: totalCost,
              durationMs: Date.now() - start,
            });
          }
        });

        // Close stdin — we pass the prompt via args, not stdin
        child.stdin.end();
      });
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

  /** ICLIAgentProvider.execute — delegates to executeTask */
  async execute(
    config: AgentTaskConfig,
    onProgress?: AgentProgressCallback,
  ): Promise<AgentTaskResult> {
    return this.executeTask(config, onProgress);
  }

  /** ICLIAgentProvider.resumeSession — convenience for session resumption */
  async resumeSession(
    sessionId: string,
    prompt: string,
    onProgress?: AgentProgressCallback,
  ): Promise<AgentTaskResult> {
    return this.executeTask({ prompt, cwd: '.', sessionId }, onProgress);
  }

  /** IProvider.initialize — no-op for CLI agent (binary is external) */
  async initialize(_config: import('./types.js').ProviderConfig): Promise<void> {
    // Claude Code CLI requires no initialization — it reads config from its own store
  }

  /**
   * Check if the `claude` CLI binary is installed and accessible.
   */
  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync('claude', ['--version']);
      return true;
    } catch {
      return false;
    }
  }

  async dispose(): Promise<void> {
    // No persistent resources to clean up
  }

  /**
   * Build CLI arguments for `claude -p`.
   */
  private buildArgs(config: AgentTaskConfig): string[] {
    const args: string[] = [
      '-p', config.prompt,
      '--output-format', 'stream-json',
      '--verbose',
    ];

    if (config.model !== undefined) {
      args.push('--model', config.model);
    }

    if (config.maxBudgetUsd !== undefined) {
      args.push('--max-budget-usd', config.maxBudgetUsd.toString());
    }

    if (config.allowedTools !== undefined && config.allowedTools.length > 0) {
      args.push('--allowedTools', config.allowedTools.join(','));
    }

    if (config.permissionMode === 'bypassPermissions') {
      args.push('--dangerously-skip-permissions');
    }

    if (config.outputFormat !== undefined) {
      args.push('--json-schema', JSON.stringify(config.outputFormat.schema));
    }

    if (config.sessionId !== undefined) {
      args.push('--resume', config.sessionId);
    }

    return args;
  }

  /**
   * Process a single stream-json message from Claude Code stdout.
   */
  private handleStreamMessage(
    msg: StreamMessage,
    onProgress: AgentProgressCallback | undefined,
    setResult: (text: string) => void,
    setCost: (cost: number) => void,
  ): void {
    if (msg.type === 'assistant') {
      const assistant = msg as StreamAssistantMessage;
      const content = assistant.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.text !== undefined) {
            emitProgress(onProgress, { type: 'text', message: block.text });
          }
          if (block.name !== undefined) {
            emitProgress(onProgress, {
              type: 'tool_use',
              message: `Using tool: ${block.name}`,
            });
          }
        }
      }
    }

    if (msg.type === 'result') {
      const result = msg as StreamResultMessage;
      if (result.cost_usd !== undefined) {
        setCost(result.cost_usd);
        emitProgress(onProgress, {
          type: 'cost_update',
          message: `Total cost: $${result.cost_usd.toFixed(4)}`,
          costSoFar: result.cost_usd,
        });
      }
      if (result.subtype === 'success' && result.result !== undefined) {
        setResult(result.result);
      }
    }
  }
}

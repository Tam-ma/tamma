import type { AgentTaskResult } from '@tamma/shared';
import type {
  IAgentProvider,
  AgentTaskConfig,
  AgentProgressCallback,
  AgentProgressEvent,
} from './agent-types.js';
import type { ICLIAgentProvider, CLIAgentCapabilities, ProviderConfig } from './types.js';

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
    '529',
    '503',
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
 * Lazy-loaded OpenCode SDK types.
 * We dynamically import `@opencode-ai/sdk` to avoid hard failures
 * when the package is not installed.
 */
interface OpenCodeClient {
  session: {
    create: (opts: { body: Record<string, unknown> }) => Promise<{ data: { id: string } }>;
    prompt: (opts: {
      path: { id: string };
      body: { parts: Array<{ type: string; text: string }>; format?: Record<string, unknown> };
    }) => Promise<{
      data: {
        parts?: Array<{ type: string; text?: string }>;
        info?: { structured_output?: unknown };
      };
    }>;
    abort: (opts: { path: { id: string } }) => Promise<void>;
  };
  global: {
    health: () => Promise<{ data: { version?: string } }>;
  };
}

/**
 * Agent provider that invokes OpenCode SDK for autonomous coding tasks.
 *
 * Follows the same pattern as ClaudeAgentProvider: retry with exponential
 * backoff, progress events, and dual-interface (IAgentProvider + ICLIAgentProvider).
 *
 * OpenCode must be running locally (the SDK connects to a local server).
 */
export class OpenCodeProvider implements IAgentProvider, ICLIAgentProvider {
  readonly name = 'opencode';
  readonly type = 'cli-agent' as const;
  readonly capabilities: CLIAgentCapabilities = {
    fileOperations: true,
    commandExecution: true,
    gitOperations: true,
    browserAutomation: false,
    mcpSupport: true,
    sessionResume: true,
    structuredOutput: true,
    streaming: false,
  };

  private sdkClient: OpenCodeClient | null = null;
  private config: ProviderConfig | null = null;

  /** IProvider.initialize — lazily load the SDK and create a client. */
  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    await this.ensureClient();
  }

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

      if (result.error !== undefined && isRetryableError(result.error)) {
        const delay = 1000 * Math.pow(2, attempt) + Math.random() * 500;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      return result;
    }

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
      const client = await this.ensureClient();

      emitProgress(onProgress, { type: 'progress', message: 'Creating OpenCode session...' });

      // Create or resume session
      let sessionId: string;
      if (config.sessionId) {
        sessionId = config.sessionId;
        emitProgress(onProgress, { type: 'progress', message: `Resuming session ${sessionId}` });
      } else {
        const session = await client.session.create({ body: {} });
        sessionId = session.data.id;
        emitProgress(onProgress, { type: 'progress', message: `Session created: ${sessionId}` });
      }

      emitProgress(onProgress, { type: 'text', message: 'Sending prompt to OpenCode...' });

      // Build prompt body
      const body: {
        parts: Array<{ type: string; text: string }>;
        format?: Record<string, unknown>;
      } = {
        parts: [{ type: 'text', text: config.prompt }],
      };

      if (config.outputFormat) {
        body.format = {
          type: 'json_schema',
          schema: config.outputFormat.schema,
        };
      }

      const response = await client.session.prompt({
        path: { id: sessionId },
        body,
      });

      // Extract text from response parts
      const parts = response.data.parts ?? [];
      const textParts = parts
        .filter((p) => p.type === 'text' && p.text !== undefined)
        .map((p) => p.text!);
      const output = textParts.join('\n');

      emitProgress(onProgress, { type: 'text', message: output });

      return {
        success: true,
        output,
        costUsd: 0,
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

  async isAvailable(): Promise<boolean> {
    try {
      const client = await this.ensureClient();
      await client.global.health();
      return true;
    } catch {
      return false;
    }
  }

  async dispose(): Promise<void> {
    this.sdkClient = null;
    this.config = null;
  }

  private async ensureClient(): Promise<OpenCodeClient> {
    if (this.sdkClient) return this.sdkClient;

    try {
      const sdk = await import('@opencode-ai/sdk');
      const createFn = sdk.createOpencodeClient ?? sdk.createOpencode;

      if (typeof createFn !== 'function') {
        throw new Error('OpenCode SDK does not export createOpencodeClient or createOpencode');
      }

      const clientOpts: Record<string, unknown> = {};
      if (this.config?.baseUrl) {
        clientOpts['baseUrl'] = this.config.baseUrl;
      }

      const result = await createFn(clientOpts);
      // SDK may return { client } or the client directly
      this.sdkClient = (result && typeof result === 'object' && 'client' in result
        ? (result as { client: OpenCodeClient }).client
        : result) as OpenCodeClient;

      return this.sdkClient;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to initialize OpenCode SDK: ${message}`);
    }
  }
}

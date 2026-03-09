/**
 * SecureAgentProvider decorator for content sanitization.
 *
 * Wraps any {@link IAgentProvider} implementation and applies content
 * sanitization to both inputs (prompt) and outputs (result, error)
 * via a pluggable {@link IContentSanitizer} instance.
 *
 * This is a classic decorator pattern: it adds sanitization behavior
 * without modifying the inner provider. Any provider (Claude, OpenAI,
 * local, etc.) can be wrapped with sanitization.
 *
 * Fields sanitized:
 * - `config.prompt` (input) via `sanitize()`
 * - `taskResult.output` (output) via `sanitizeOutput()`
 * - `taskResult.error` (output) via `sanitizeOutput()` if present
 *
 * Fields NOT sanitized (by design):
 * - `config.cwd`, `config.allowedTools`, `config.permissionMode`
 *   (controlled by the resolver config, not external input)
 *
 * @module
 */

import type { AgentTaskConfig, AgentProgressCallback, IAgentProvider } from './agent-types.js';
import type { AgentTaskResult, ILogger, IContentSanitizer } from '@tamma/shared';

/**
 * Decorator that wraps an IAgentProvider with content sanitization.
 *
 * Accepts {@link IContentSanitizer} (interface, not concrete class) for
 * Dependency Inversion Principle (DIP) consistency with other Epic 9
 * interfaces (IProviderHealthTracker, IAgentProviderFactory,
 * IProviderChain, IAgentPromptRegistry).
 */
export class SecureAgentProvider implements IAgentProvider {
  constructor(
    private readonly _inner: IAgentProvider,
    private readonly _sanitizer: IContentSanitizer,
    private readonly _logger?: ILogger,
  ) {}

  /**
   * Execute a task with content sanitization applied to inputs and outputs.
   *
   * Pre-call: sanitizes `config.prompt` via `sanitize()`
   * Post-call: sanitizes `taskResult.output` and `taskResult.error` via `sanitizeOutput()`
   *
   * Creates new config and result objects; never mutates the originals.
   */
  async executeTask(
    config: AgentTaskConfig,
    onProgress?: AgentProgressCallback,
  ): Promise<AgentTaskResult> {
    // Pre: sanitize config.prompt
    const { result: sanitizedPrompt, warnings } = this._sanitizer.sanitize(config.prompt);
    for (const w of warnings) {
      this._logger?.warn('Sanitization warning', { warning: w });
    }

    // Create new config object (shallow copy is sufficient; we only modify prompt)
    const sanitizedConfig: AgentTaskConfig = { ...config, prompt: sanitizedPrompt };
    const taskResult = await this._inner.executeTask(sanitizedConfig, onProgress);

    // Post: sanitize output
    const { result: sanitizedOutput } = this._sanitizer.sanitizeOutput(taskResult.output);

    // Post: sanitize error if present (non-nullish)
    const sanitizedError = taskResult.error !== undefined && taskResult.error !== null
      ? this._sanitizer.sanitizeOutput(taskResult.error).result
      : taskResult.error;

    // Create new result object (never mutate the inner result)
    const result: AgentTaskResult = {
      ...taskResult,
      output: sanitizedOutput,
    };

    // Use conditional assignment for optional property with exactOptionalPropertyTypes
    if (sanitizedError !== undefined) {
      result.error = sanitizedError;
    }

    return result;
  }

  /**
   * Delegates to the inner provider's isAvailable().
   */
  async isAvailable(): Promise<boolean> {
    return this._inner.isAvailable();
  }

  /**
   * Delegates to the inner provider's dispose().
   */
  async dispose(): Promise<void> {
    return this._inner.dispose();
  }
}

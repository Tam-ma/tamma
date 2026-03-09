/**
 * Tool Interceptor Chain
 *
 * Provides blocking (awaited) pre and post transformation hooks
 * for MCP tool calls. Interceptors run in registration order,
 * piping output from one into the next.
 *
 * - Pre-interceptors transform tool arguments before execution
 * - Post-interceptors transform tool results after execution
 * - Errors are isolated per-interceptor (fail-open by default)
 * - Prototype pollution keys are stripped from returned args (F16)
 * - Warnings are accumulated from all interceptors
 */

import type { ToolResult } from './types.js';

/**
 * Pre-interceptor function type.
 * Receives tool name and args, returns (possibly modified) args and warnings.
 */
export type PreInterceptor = (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<{ args: Record<string, unknown>; warnings: string[] }>;

/**
 * Post-interceptor function type.
 * Receives tool name and result, returns (possibly modified) result and warnings.
 */
export type PostInterceptor = (
  toolName: string,
  result: ToolResult,
) => Promise<{ result: ToolResult; warnings: string[] }>;

/**
 * Forbidden keys that indicate prototype pollution attempts (F16).
 */
const PROTOTYPE_POLLUTION_KEYS = ['__proto__', 'constructor', 'prototype'] as const;

/**
 * Strips prototype pollution keys from an object and returns warnings
 * for each key removed.
 */
function _stripPrototypePollutionKeys(
  obj: Record<string, unknown>,
): string[] {
  const warnings: string[] = [];
  for (const key of PROTOTYPE_POLLUTION_KEYS) {
    if (Object.hasOwn(obj, key)) {
      // Use Reflect.deleteProperty to avoid issues with __proto__
      Reflect.deleteProperty(obj, key);
      warnings.push(`Prototype pollution key "${key}" removed from interceptor output`);
    }
  }
  return warnings;
}

/**
 * Blocking pre/post interceptor chain for MCP tool calls.
 *
 * Each interceptor is awaited in registration order, with the output
 * of one piped as input to the next. Errors are caught per-interceptor
 * and the chain continues with unmodified args/result (fail-open).
 *
 * An empty chain is a no-op passthrough.
 */
export class ToolInterceptorChain {
  private readonly _preInterceptors: PreInterceptor[] = [];
  private readonly _postInterceptors: PostInterceptor[] = [];

  /**
   * Add a pre-interceptor to the chain.
   * Pre-interceptors run before tool execution, transforming args.
   */
  addPreInterceptor(fn: PreInterceptor): void {
    this._preInterceptors.push(fn);
  }

  /**
   * Add a post-interceptor to the chain.
   * Post-interceptors run after tool execution, transforming results.
   */
  addPostInterceptor(fn: PostInterceptor): void {
    this._postInterceptors.push(fn);
  }

  /**
   * Run all pre-interceptors in registration order.
   * Each interceptor receives the output args of the previous one.
   * On interceptor error: fail-open (continue with unmodified args, add warning).
   * Prototype pollution keys are stripped from returned args (F16).
   *
   * @param toolName - Name of the MCP tool being invoked
   * @param args - Tool invocation arguments
   * @returns Final args and accumulated warnings
   */
  async runPre(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ args: Record<string, unknown>; warnings: string[] }> {
    let current = args;
    const warnings: string[] = [];

    for (const fn of this._preInterceptors) {
      try {
        const result = await fn(toolName, current);

        // Validate returned args for prototype pollution keys (F16)
        if (result.args && typeof result.args === 'object') {
          const pollutionWarnings = _stripPrototypePollutionKeys(result.args);
          warnings.push(...pollutionWarnings);
        }

        current = result.args;
        warnings.push(...result.warnings);
      } catch (err: unknown) {
        warnings.push(
          `Pre-interceptor failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        // Continue with unmodified args (fail-open for non-security interceptors) (F09)
      }
    }

    return { args: current, warnings };
  }

  /**
   * Run all post-interceptors in registration order.
   * Each interceptor receives the output result of the previous one.
   * On interceptor error: fail-open (continue with unmodified result, add warning).
   *
   * @param toolName - Name of the MCP tool being invoked
   * @param result - Tool invocation result
   * @returns Final result and accumulated warnings
   */
  async runPost(
    toolName: string,
    result: ToolResult,
  ): Promise<{ result: ToolResult; warnings: string[] }> {
    let current = result;
    const warnings: string[] = [];

    for (const fn of this._postInterceptors) {
      try {
        const out = await fn(toolName, current);
        current = out.result;
        warnings.push(...out.warnings);
      } catch (err: unknown) {
        warnings.push(
          `Post-interceptor failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        // Continue with unmodified result (fail-open for non-security interceptors) (F09)
      }
    }

    return { result: current, warnings };
  }
}

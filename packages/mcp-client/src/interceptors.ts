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

import type { IContentSanitizer } from '@tamma/shared';
import type { ToolResult, ToolResultContent } from './types.js';

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
 * Strips prototype pollution keys from an object and returns a clean copy
 * plus warnings for each key removed. Does NOT mutate the input object.
 */
function _stripPrototypePollutionKeys(
  obj: Record<string, unknown>,
): { cleaned: Record<string, unknown>; warnings: string[] } {
  const warnings: string[] = [];
  let needsCleaning = false;
  for (const key of PROTOTYPE_POLLUTION_KEYS) {
    if (Object.hasOwn(obj, key)) {
      needsCleaning = true;
      warnings.push(`Prototype pollution key "${key}" removed from interceptor output`);
    }
  }
  if (!needsCleaning) {
    return { cleaned: obj, warnings };
  }
  // Create a clean copy without the polluted keys
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!PROTOTYPE_POLLUTION_KEYS.includes(key as typeof PROTOTYPE_POLLUTION_KEYS[number])) {
      cleaned[key] = value;
    }
  }
  return { cleaned, warnings };
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
          const { cleaned, warnings: pollutionWarnings } = _stripPrototypePollutionKeys(result.args);
          warnings.push(...pollutionWarnings);
          current = cleaned;
        } else {
          current = result.args;
        }
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

// --- Built-in interceptor factories ---

/**
 * Type for the validateUrl function signature from Story 9-7.
 * Returns `{ valid: boolean; warnings: string[] }`.
 */
export type ValidateUrlFn = (url: string) => { valid: boolean; warnings: string[] };

/**
 * Creates a post-interceptor that sanitizes text content in tool results.
 *
 * Uses `IContentSanitizer` from Story 9-7 (F10).
 * Iterates `result.content` and sanitizes each `text`-typed item.
 * Returns a new ToolResult (does not mutate input).
 * Collects warnings from each sanitization call.
 *
 * @param sanitizer - An IContentSanitizer instance (from Story 9-7)
 * @returns A PostInterceptor function
 */
export function createSanitizationInterceptor(
  sanitizer: IContentSanitizer,
): PostInterceptor {
  return async (_toolName: string, result: ToolResult) => {
    const warnings: string[] = [];
    const sanitizedContent: ToolResultContent[] = result.content.map(
      (item): ToolResultContent => {
        if (item.type === 'text') {
          const { result: sanitized, warnings: w } = sanitizer.sanitizeOutput(
            item.text,
          );
          warnings.push(...w);
          if (sanitized !== item.text) {
            return { ...item, text: sanitized };
          }
          return item;
        }
        return item;
      },
    );

    return {
      result: { ...result, content: sanitizedContent },
      warnings,
    };
  };
}

/**
 * Creates a pre-interceptor that validates URL-like values in tool args.
 *
 * Uses the `validateUrl()` function signature from Story 9-7 (F11).
 * Scans top-level arg values for strings containing `://` or starting with `http`.
 * For each URL-like value, calls `validateUrl(url)`.
 * Collects warnings and **replaces blocked URLs** with a safe placeholder.
 *
 * SECURITY: This interceptor blocks invalid URLs by replacing them in args
 * (fail-closed). The original URL is reported in warnings.
 *
 * @param validateUrlFn - A function matching `(url: string) => { valid: boolean; warnings: string[] }`
 * @returns A PreInterceptor function
 */
export function createUrlValidationInterceptor(
  validateUrlFn: ValidateUrlFn,
): PreInterceptor {
  return async (
    _toolName: string,
    args: Record<string, unknown>,
  ) => {
    const warnings: string[] = [];
    let modified = false;
    const cleanedArgs: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(args)) {
      if (
        typeof value === 'string' &&
        (value.includes('://') || value.startsWith('http'))
      ) {
        const { valid, warnings: w } = validateUrlFn(value);
        warnings.push(...w);
        if (!valid) {
          const truncatedUrl = value.length > 200 ? value.slice(0, 200) + '...' : value;
          warnings.push(`URL blocked by policy: ${truncatedUrl}`);
          cleanedArgs[key] = '[URL_BLOCKED_BY_POLICY]';
          modified = true;
          continue;
        }
      }
      cleanedArgs[key] = value;
    }

    return { args: modified ? cleanedArgs : args, warnings };
  };
}

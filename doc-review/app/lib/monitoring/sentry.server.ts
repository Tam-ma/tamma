/**
 * Sentry Error Tracking Configuration
 *
 * This module provides error tracking and performance monitoring for production.
 * Sentry is recommended for Cloudflare Workers due to its excellent Workers support.
 *
 * Setup:
 * 1. Create account at https://sentry.io
 * 2. Create new project for Cloudflare Workers
 * 3. Set SENTRY_DSN secret: wrangler pages secret put SENTRY_DSN
 * 4. Optional: Set SENTRY_ENVIRONMENT (defaults to NODE_ENV)
 */

import type { AppLoadContext } from 'react-router';

interface SentryConfig {
  dsn: string;
  environment: string;
  release?: string;
  sampleRate: number;
  tracesSampleRate: number;
}

interface SentryEvent {
  message?: string;
  level: 'fatal' | 'error' | 'warning' | 'info' | 'debug';
  exception?: {
    values: Array<{
      type: string;
      value: string;
      stacktrace?: {
        frames: Array<{
          filename: string;
          function: string;
          lineno: number;
          colno: number;
        }>;
      };
    }>;
  };
  user?: {
    id: string;
    email?: string;
    username?: string;
  };
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  request?: {
    url: string;
    method: string;
    headers: Record<string, string>;
  };
  timestamp?: number;
}

class SentryClient {
  private config: SentryConfig;
  private enabled: boolean;

  constructor(config: SentryConfig) {
    this.config = config;
    this.enabled = !!config.dsn;
  }

  /**
   * Capture an exception and send to Sentry
   */
  async captureException(
    error: Error,
    context?: {
      user?: { id: string; email?: string; username?: string };
      tags?: Record<string, string>;
      extra?: Record<string, unknown>;
      request?: Request;
    }
  ): Promise<void> {
    if (!this.enabled) {
      console.error('Sentry not configured, error not sent:', error);
      return;
    }

    try {
      const event = this.buildEvent({
        level: 'error',
        exception: {
          values: [
            {
              type: error.name,
              value: error.message,
              stacktrace: this.parseStackTrace(error.stack),
            },
          ],
        },
        user: context?.user,
        tags: context?.tags,
        extra: context?.extra,
        request: context?.request
          ? {
              url: context.request.url,
              method: context.request.method,
              headers: this.sanitizeHeaders(context.request.headers),
            }
          : undefined,
      });

      await this.sendEvent(event);
    } catch (sendError) {
      console.error('Failed to send error to Sentry:', sendError);
    }
  }

  /**
   * Capture a message and send to Sentry
   */
  async captureMessage(
    message: string,
    level: 'fatal' | 'error' | 'warning' | 'info' | 'debug' = 'info',
    context?: {
      user?: { id: string; email?: string; username?: string };
      tags?: Record<string, string>;
      extra?: Record<string, unknown>;
    }
  ): Promise<void> {
    if (!this.enabled) {
      console.log('Sentry not configured, message not sent:', message);
      return;
    }

    try {
      const event = this.buildEvent({
        message,
        level,
        user: context?.user,
        tags: context?.tags,
        extra: context?.extra,
      });

      await this.sendEvent(event);
    } catch (sendError) {
      console.error('Failed to send message to Sentry:', sendError);
    }
  }

  /**
   * Build a Sentry event object
   */
  private buildEvent(partial: Partial<SentryEvent>): SentryEvent {
    return {
      level: partial.level || 'error',
      timestamp: Math.floor(Date.now() / 1000),
      ...partial,
      tags: {
        environment: this.config.environment,
        release: this.config.release || 'unknown',
        ...partial.tags,
      },
    };
  }

  /**
   * Send event to Sentry API
   */
  private async sendEvent(event: SentryEvent): Promise<void> {
    // Sample events based on sample rate
    if (Math.random() > this.config.sampleRate) {
      return;
    }

    // Parse DSN
    const dsnMatch = this.config.dsn.match(
      /^https:\/\/([^@]+)@([^\/]+)\/(.+)$/
    );
    if (!dsnMatch) {
      throw new Error('Invalid Sentry DSN format');
    }

    const [, publicKey, host, projectId] = dsnMatch;
    const endpoint = `https://${host}/api/${projectId}/store/`;

    // Send to Sentry
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${publicKey}, sentry_client=tamma-doc-review/1.0.0`,
      },
      body: JSON.stringify(event),
    });

    if (!response.ok) {
      throw new Error(`Sentry API error: ${response.status} ${response.statusText}`);
    }
  }

  /**
   * Parse stack trace into Sentry format
   */
  private parseStackTrace(
    stack?: string
  ): NonNullable<SentryEvent['exception']>['values'][0]['stacktrace'] | undefined {
    if (!stack) return undefined;

    const frames = stack
      .split('\n')
      .slice(1) // Skip first line (error message)
      .map((line) => {
        const match = line.match(/at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/);
        if (match) {
          const [, func, filename, lineno, colno] = match;
          return {
            function: func.trim(),
            filename: filename.trim(),
            lineno: parseInt(lineno, 10),
            colno: parseInt(colno, 10),
          };
        }
        return null;
      })
      .filter((frame): frame is NonNullable<typeof frame> => frame !== null);

    return frames.length > 0 ? { frames } : undefined;
  }

  /**
   * Sanitize headers to remove sensitive information
   */
  private sanitizeHeaders(headers: Headers): Record<string, string> {
    const sanitized: Record<string, string> = {};
    const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key'];

    headers.forEach((value, key) => {
      if (sensitiveHeaders.includes(key.toLowerCase())) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = value;
      }
    });

    return sanitized;
  }
}

/**
 * Initialize Sentry client from context
 */
export function initSentry(context: AppLoadContext): SentryClient {
  const env = (context as any).cloudflare?.env || {};

  const config: SentryConfig = {
    dsn: env.SENTRY_DSN || '',
    environment: env.SENTRY_ENVIRONMENT || env.NODE_ENV || 'development',
    release: env.APP_VERSION || 'unknown',
    sampleRate: parseFloat(env.SENTRY_SAMPLE_RATE || '1.0'),
    tracesSampleRate: parseFloat(env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
  };

  return new SentryClient(config);
}

/**
 * Middleware to catch and report errors
 */
export async function withErrorTracking<T>(
  fn: () => Promise<T>,
  context: AppLoadContext,
  options?: {
    user?: { id: string; email?: string; username?: string };
    tags?: Record<string, string>;
    request?: Request;
  }
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const sentry = initSentry(context);

    if (error instanceof Error) {
      await sentry.captureException(error, {
        user: options?.user,
        tags: options?.tags,
        request: options?.request,
      });
    } else {
      await sentry.captureMessage(
        `Non-error thrown: ${String(error)}`,
        'error',
        {
          user: options?.user,
          tags: options?.tags,
          extra: { thrownValue: error },
        }
      );
    }

    throw error;
  }
}

/**
 * ELSA workflow engine HTTP client.
 *
 * Communicates with the ELSA Server REST API to manage workflow instances.
 * Includes retry logic with exponential backoff for transient failures.
 */

import type { IWorkflowEngine, WorkflowInstanceStatus } from './workflow-engine.js';

export interface ElsaClientConfig {
  baseUrl: string;
  apiKey: string;
  /** Request timeout in milliseconds. Defaults to 30 000. */
  requestTimeoutMs?: number;
  /** Maximum number of retries for transient failures. Defaults to 3. */
  maxRetries?: number;
  /** Initial backoff delay in milliseconds. Defaults to 1000. */
  initialBackoffMs?: number;
}

/** Default retry configuration. */
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_BACKOFF_MS = 1000;

export class ElsaClient implements IWorkflowEngine {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly requestTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly initialBackoffMs: number;

  constructor(config: ElsaClientConfig) {
    // Strip trailing slashes for consistent URL construction.
    // Avoid regex /\/+$/ which is O(n^2) on strings with many '/' characters.
    let url = config.baseUrl;
    while (url.length > 0 && url.endsWith('/')) {
      url = url.slice(0, -1);
    }
    this.baseUrl = url;
    this.apiKey = config.apiKey;
    this.requestTimeoutMs = config.requestTimeoutMs ?? 30_000;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.initialBackoffMs = config.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
  }

  async startWorkflow(name: string, input: Record<string, unknown>): Promise<string> {
    const response = await this.request<{ workflowInstanceId: string }>(
      'POST',
      '/api/workflow-definitions/by-name/{name}/execute',
      { name },
      { input },
    );
    return response.workflowInstanceId;
  }

  async getWorkflowStatus(instanceId: string): Promise<WorkflowInstanceStatus> {
    const response = await this.request<ElsaInstanceResponse>(
      'GET',
      '/api/workflow-instances/{instanceId}',
      { instanceId },
    );
    return this.mapInstanceResponse(response);
  }

  async pauseWorkflow(instanceId: string): Promise<void> {
    await this.request<void>(
      'POST',
      '/api/workflow-instances/{instanceId}/suspend',
      { instanceId },
    );
  }

  async resumeWorkflow(instanceId: string): Promise<void> {
    await this.request<void>(
      'POST',
      '/api/workflow-instances/{instanceId}/resume',
      { instanceId },
    );
  }

  async cancelWorkflow(instanceId: string): Promise<void> {
    await this.request<void>(
      'POST',
      '/api/workflow-instances/{instanceId}/cancel',
      { instanceId },
    );
  }

  async sendSignal(instanceId: string, signal: string, payload?: unknown): Promise<void> {
    await this.request<void>(
      'POST',
      '/api/workflow-instances/{instanceId}/signals/{signal}',
      { instanceId, signal },
      payload !== undefined ? { payload } : undefined,
    );
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private async request<T>(
    method: string,
    pathTemplate: string,
    pathParams: Record<string, string> = {},
    body?: unknown,
  ): Promise<T> {
    let path = pathTemplate;
    for (const [key, value] of Object.entries(pathParams)) {
      path = path.replace(`{${key}}`, encodeURIComponent(value));
    }

    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Authorization': `ApiKey ${this.apiKey}`,
      'Accept': 'application/json',
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          method,
          headers,
          signal: AbortSignal.timeout(this.requestTimeoutMs),
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });

        if (!response.ok) {
          const text = await response.text().catch(() => '');
          const err = new Error(
            `ELSA API ${method} ${path} returned ${response.status}: ${text}`,
          );
          // Only retry on server errors or rate limiting
          if (response.status >= 500 || response.status === 429) {
            lastError = err;
            await this.backoff(attempt);
            continue;
          }
          throw err;
        }

        // Some endpoints (suspend, resume, cancel) may return empty bodies
        const contentType = response.headers.get('content-type') ?? '';
        if (contentType.includes('application/json')) {
          return (await response.json()) as T;
        }
        return undefined as unknown as T;
      } catch (err: unknown) {
        // Any error reaching this catch block is either a network-level failure
        // (TypeError, DNS, timeout, connection reset, etc.) or an unexpected
        // runtime error. Non-retryable HTTP errors (4xx) are already thrown
        // inside the `if (!response.ok)` block above and will not reach here.
        // Treat all remaining errors as retryable.
        lastError = err instanceof Error ? err : new Error(String(err));
        await this.backoff(attempt);
        continue;
      }
    }

    throw lastError ?? new Error(`ELSA API request failed after ${this.maxRetries} retries`);
  }

  private async backoff(attempt: number): Promise<void> {
    const delay = this.initialBackoffMs * Math.pow(2, attempt) * (0.5 + Math.random());
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  private mapInstanceResponse(raw: ElsaInstanceResponse): WorkflowInstanceStatus {
    return {
      instanceId: raw.id,
      definitionId: raw.definitionId,
      status: this.mapStatus(raw.status),
      ...(raw.currentActivity?.activityId !== undefined
        ? { currentActivity: raw.currentActivity.activityId }
        : {}),
      ...(raw.createdAt !== undefined ? { createdAt: raw.createdAt } : {}),
      ...(raw.finishedAt !== undefined ? { completedAt: raw.finishedAt } : {}),
      variables: raw.variables ?? {},
    };
  }

  private mapStatus(
    status: string,
  ): WorkflowInstanceStatus['status'] {
    const map: Record<string, WorkflowInstanceStatus['status']> = {
      Running: 'Running',
      Suspended: 'Suspended',
      Finished: 'Finished',
      Cancelled: 'Cancelled',
      Faulted: 'Faulted',
    };
    return map[status] ?? 'Unknown';
  }
}

// ---------------------------------------------------------------------------
// ELSA response shapes (internal, not exported)
// ---------------------------------------------------------------------------

interface ElsaInstanceResponse {
  id: string;
  definitionId: string;
  status: string;
  currentActivity?: { activityId: string };
  createdAt?: string;
  finishedAt?: string;
  variables?: Record<string, unknown>;
}

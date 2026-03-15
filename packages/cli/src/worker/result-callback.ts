/**
 * WorkerResultCallback handles reporting worker results back to the
 * Tamma orchestrator API. Used by the process-issue command when running
 * inside GitHub Actions or any CI environment.
 */

import type { ILogger } from '@tamma/shared/contracts';

/** Data sent on success. */
export interface WorkerSuccessData {
  issueNumber: number;
  installationId: string;
  prNumber?: number;
  prUrl?: string;
  costUsd?: number;
  durationMs?: number;
}

/** Data sent on failure. */
export interface WorkerFailureData {
  issueNumber: number;
  installationId: string;
  error: string;
  step?: string;
}

/** Status update sent during processing. */
export interface WorkerStatusData {
  status: string;
  step: string;
  issueNumber?: number;
  installationId?: string;
}

/** Options for constructing a WorkerResultCallback. */
export interface WorkerResultCallbackOptions {
  apiKey: string;
  apiUrl: string;
  logger: ILogger;
  maxRetries?: number;
  baseDelayMs?: number;
}

export class WorkerResultCallback {
  private readonly apiKey: string;
  private readonly apiUrl: string;
  private readonly logger: ILogger;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;

  constructor(options: WorkerResultCallbackOptions) {
    this.apiKey = options.apiKey;
    this.apiUrl = options.apiUrl.replace(/\/$/, ''); // strip trailing slash
    this.logger = options.logger;
    this.maxRetries = options.maxRetries ?? 3;
    this.baseDelayMs = options.baseDelayMs ?? 1000;
  }

  /**
   * Report a successful workflow completion to the orchestrator.
   */
  async reportSuccess(workflowId: string, data: WorkerSuccessData): Promise<void> {
    const payload = {
      status: 'success',
      issueNumber: data.issueNumber,
      installationId: data.installationId,
      ...(data.prNumber !== undefined ? { prNumber: data.prNumber } : {}),
      ...(data.prUrl !== undefined ? { prUrl: data.prUrl } : {}),
      ...(data.costUsd !== undefined ? { costUsd: data.costUsd } : {}),
      ...(data.durationMs !== undefined ? { durationMs: data.durationMs } : {}),
    };

    await this.postResult(workflowId, payload);
  }

  /**
   * Report a workflow failure to the orchestrator.
   */
  async reportFailure(workflowId: string, data: WorkerFailureData): Promise<void> {
    const payload = {
      status: 'failure',
      issueNumber: data.issueNumber,
      installationId: data.installationId,
      error: data.error,
      ...(data.step !== undefined ? { step: data.step } : {}),
    };

    await this.postResult(workflowId, payload);
  }

  /**
   * Report a status update during workflow processing.
   */
  async reportStatus(workflowId: string, status: string, step: string): Promise<void> {
    const url = `${this.apiUrl}/api/v1/workflows/${encodeURIComponent(workflowId)}/status`;
    const body: WorkerStatusData = { status, step };

    await this.postWithRetry(url, body);
  }

  /**
   * POST result to the orchestrator's workflow result endpoint.
   */
  private async postResult(workflowId: string, payload: Record<string, unknown>): Promise<void> {
    const url = `${this.apiUrl}/api/v1/workflows/${encodeURIComponent(workflowId)}/result`;
    await this.postWithRetry(url, payload);
  }

  /**
   * POST with exponential backoff retry. On retry exhaustion, logs a warning
   * but does NOT throw — the orchestrator will detect missing callbacks via timeout.
   */
  private async postWithRetry(url: string, body: Record<string, unknown>): Promise<void> {
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });

        if (response.ok) {
          this.logger.info('Callback reported successfully', { url, attempt: attempt + 1 });
          return;
        }

        const responseText = await response.text().catch(() => '<unreadable>');
        this.logger.warn('Callback response not OK', {
          url,
          status: response.status,
          body: responseText,
          attempt: attempt + 1,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn('Callback request failed', {
          url,
          error: message,
          attempt: attempt + 1,
          maxRetries: this.maxRetries,
        });
      }

      // Exponential backoff: 1s, 2s, 4s
      if (attempt < this.maxRetries - 1) {
        const delayMs = this.baseDelayMs * Math.pow(2, attempt);
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }
    }

    // All retries exhausted — log warning but do not throw.
    // The orchestrator will detect missing callbacks via timeout.
    this.logger.warn('All callback retries exhausted. Orchestrator will detect via timeout.', {
      url,
      maxRetries: this.maxRetries,
    });
  }
}

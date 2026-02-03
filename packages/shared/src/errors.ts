/**
 * Error class hierarchy for the Tamma platform
 */

export class TammaError extends Error {
  public readonly code: string;
  public readonly retryable: boolean;
  public readonly context: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    options?: { retryable?: boolean; context?: Record<string, unknown>; cause?: Error },
  ) {
    super(message, { cause: options?.cause });
    this.name = 'TammaError';
    this.code = code;
    this.retryable = options?.retryable ?? false;
    this.context = options?.context ?? {};
  }
}

export class EngineError extends TammaError {
  constructor(
    message: string,
    options?: { retryable?: boolean; context?: Record<string, unknown>; cause?: Error },
  ) {
    super(message, 'ENGINE_ERROR', options);
    this.name = 'EngineError';
  }
}

export class WorkflowError extends TammaError {
  constructor(
    message: string,
    options?: { retryable?: boolean; context?: Record<string, unknown>; cause?: Error },
  ) {
    super(message, 'WORKFLOW_ERROR', options);
    this.name = 'WorkflowError';
  }
}

export class ConfigurationError extends TammaError {
  constructor(
    message: string,
    options?: { context?: Record<string, unknown>; cause?: Error },
  ) {
    super(message, 'CONFIGURATION_ERROR', { retryable: false, ...options });
    this.name = 'ConfigurationError';
  }
}

export class PlatformError extends TammaError {
  constructor(
    message: string,
    options?: { retryable?: boolean; context?: Record<string, unknown>; cause?: Error },
  ) {
    super(message, 'PLATFORM_ERROR', options);
    this.name = 'PlatformError';
  }
}

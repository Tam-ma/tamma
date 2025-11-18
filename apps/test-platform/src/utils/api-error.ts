/**
 * Custom API Error class for handling application-specific errors
 * Provides structured error responses with status codes and optional details
 */

export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly details?: any;
  public readonly isOperational: boolean;

  constructor(
    statusCode: number,
    message: string,
    details?: any,
    isOperational: boolean = true
  ) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = isOperational;

    // Maintains proper stack trace for where error was thrown
    Error.captureStackTrace(this, this.constructor);

    // Set the prototype explicitly for instanceof checks
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  // Common error factory methods
  static badRequest(message: string = 'Bad Request', details?: any): ApiError {
    return new ApiError(400, message, details);
  }

  static unauthorized(message: string = 'Unauthorized', details?: any): ApiError {
    return new ApiError(401, message, details);
  }

  static forbidden(message: string = 'Forbidden', details?: any): ApiError {
    return new ApiError(403, message, details);
  }

  static notFound(message: string = 'Resource not found', details?: any): ApiError {
    return new ApiError(404, message, details);
  }

  static conflict(message: string = 'Conflict', details?: any): ApiError {
    return new ApiError(409, message, details);
  }

  static unprocessableEntity(message: string = 'Unprocessable Entity', details?: any): ApiError {
    return new ApiError(422, message, details);
  }

  static tooManyRequests(message: string = 'Too Many Requests', details?: any): ApiError {
    return new ApiError(429, message, details);
  }

  static internalServerError(message: string = 'Internal Server Error', details?: any): ApiError {
    return new ApiError(500, message, details, false);
  }

  static serviceUnavailable(message: string = 'Service Unavailable', details?: any): ApiError {
    return new ApiError(503, message, details, false);
  }

  // Convert error to JSON for API responses
  toJSON(): object {
    return {
      error: {
        message: this.message,
        statusCode: this.statusCode,
        ...(this.details && { details: this.details }),
      },
    };
  }
}

// Type guard to check if an error is an ApiError
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

// Helper to handle unknown errors and convert them to ApiError
export function handleError(error: unknown): ApiError {
  if (isApiError(error)) {
    return error;
  }

  if (error instanceof Error) {
    // Check for common database errors
    if (error.message.includes('duplicate key') || error.message.includes('UNIQUE constraint')) {
      return ApiError.conflict('Resource already exists', { originalError: error.message });
    }

    if (error.message.includes('foreign key constraint')) {
      return ApiError.badRequest('Invalid reference', { originalError: error.message });
    }

    if (error.message.includes('not found')) {
      return ApiError.notFound(error.message);
    }

    // Default to internal server error for unknown errors
    return ApiError.internalServerError(error.message);
  }

  // Handle non-Error objects
  return ApiError.internalServerError('An unknown error occurred', { error });
}
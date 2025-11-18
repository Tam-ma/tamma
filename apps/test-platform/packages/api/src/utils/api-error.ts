/**
 * Custom API Error class for handling application-specific errors
 */

export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly details?: any;
  public readonly code?: string;

  constructor(statusCode: number, message: string, details?: any, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.details = details;
    this.code = code;

    // Maintain proper stack trace for debugging
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ApiError);
    }
  }

  /**
   * Create a 400 Bad Request error
   */
  static badRequest(message: string = 'Bad Request', details?: any): ApiError {
    return new ApiError(400, message, details, 'BAD_REQUEST');
  }

  /**
   * Create a 401 Unauthorized error
   */
  static unauthorized(message: string = 'Unauthorized', details?: any): ApiError {
    return new ApiError(401, message, details, 'UNAUTHORIZED');
  }

  /**
   * Create a 403 Forbidden error
   */
  static forbidden(message: string = 'Forbidden', details?: any): ApiError {
    return new ApiError(403, message, details, 'FORBIDDEN');
  }

  /**
   * Create a 404 Not Found error
   */
  static notFound(message: string = 'Not Found', details?: any): ApiError {
    return new ApiError(404, message, details, 'NOT_FOUND');
  }

  /**
   * Create a 409 Conflict error
   */
  static conflict(message: string = 'Conflict', details?: any): ApiError {
    return new ApiError(409, message, details, 'CONFLICT');
  }

  /**
   * Create a 422 Unprocessable Entity error
   */
  static unprocessableEntity(message: string = 'Unprocessable Entity', details?: any): ApiError {
    return new ApiError(422, message, details, 'UNPROCESSABLE_ENTITY');
  }

  /**
   * Create a 429 Too Many Requests error
   */
  static tooManyRequests(message: string = 'Too Many Requests', details?: any): ApiError {
    return new ApiError(429, message, details, 'TOO_MANY_REQUESTS');
  }

  /**
   * Create a 500 Internal Server Error
   */
  static internalServer(message: string = 'Internal Server Error', details?: any): ApiError {
    return new ApiError(500, message, details, 'INTERNAL_SERVER_ERROR');
  }

  /**
   * Create a 503 Service Unavailable error
   */
  static serviceUnavailable(message: string = 'Service Unavailable', details?: any): ApiError {
    return new ApiError(503, message, details, 'SERVICE_UNAVAILABLE');
  }

  /**
   * Convert to JSON for API responses
   */
  toJSON() {
    return {
      error: {
        message: this.message,
        code: this.code,
        statusCode: this.statusCode,
        details: this.details,
      },
    };
  }
}
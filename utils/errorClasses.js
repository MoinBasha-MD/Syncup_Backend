/**
 * Base API Error class
 */
class ApiError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * 400 Bad Request Error
 */
class BadRequestError extends ApiError {
  constructor(message = 'Bad Request') {
    super(message, 400);
  }
}

/**
 * 401 Unauthorized Error
 */
class UnauthorizedError extends ApiError {
  constructor(message = 'Unauthorized') {
    super(message, 401);
  }
}

/**
 * 403 Forbidden Error
 */
class ForbiddenError extends ApiError {
  constructor(message = 'Forbidden') {
    super(message, 403);
  }
}

/**
 * 404 Not Found Error
 */
class NotFoundError extends ApiError {
  constructor(message = 'Resource not found') {
    super(message, 404);
  }
}

/**
 * 409 Conflict Error
 */
class ConflictError extends ApiError {
  constructor(message = 'Resource conflict') {
    super(message, 409);
  }
}

/**
 * 429 Too Many Requests Error
 */
class TooManyRequestsError extends ApiError {
  constructor(message = 'Too many requests, please try again later') {
    super(message, 429);
  }
}

/**
 * 500 Internal Server Error
 */
class InternalServerError extends ApiError {
  constructor(message = 'Internal server error') {
    super(message, 500);
  }
}

/**
 * 503 Service Unavailable Error
 */
class ServiceUnavailableError extends ApiError {
  constructor(message = 'Service unavailable') {
    super(message, 503);
  }
}

module.exports = {
  ApiError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  TooManyRequestsError,
  InternalServerError,
  ServiceUnavailableError
};

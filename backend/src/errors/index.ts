/**
 * Centralized error definitions.
 *
 * All errors thrown inside route handlers must be one of these classes (or a
 * subclass). The Hono error handler converts them to the uniform JSON shape
 * required by the frontend contract:
 *
 *   { status, code, message, details? }
 */

export interface ErrorBody {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }

  toBody(): ErrorBody {
    return {
      status: this.status,
      code: this.code,
      message: this.message,
      ...(this.details !== undefined ? { details: this.details } : {}),
    };
  }
}

// --- 400 family ----------------------------------------------------------

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, "validation_error", message, details);
    this.name = "ValidationError";
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, "bad_request", message, details);
    this.name = "BadRequestError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super(401, "unauthorized", message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(403, "forbidden", message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends AppError {
  constructor(resource = "Resource") {
    super(404, "not_found", `${resource} not found`);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(409, "conflict", message, details);
    this.name = "ConflictError";
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = "Too many requests") {
    super(429, "rate_limited", message);
    this.name = "TooManyRequestsError";
  }
}

export class SubscriptionRequiredError extends AppError {
  constructor(message = "An active subscription is required to send messages.") {
    super(403, "SUBSCRIPTION_REQUIRED", message);
    this.name = "SubscriptionRequiredError";
  }
}

// --- 500 family ----------------------------------------------------------

export class InternalError extends AppError {
  constructor(message = "An unexpected error occurred") {
    super(500, "internal_error", message);
    this.name = "InternalError";
  }
}

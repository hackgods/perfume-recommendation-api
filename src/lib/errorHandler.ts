import { Request, Response, NextFunction } from "express";
import { logger } from "./logger";

export class AppError extends Error {
  constructor(
    public code: string,
    public statusCode: number,
    message: string,
    public requestId?: string
  ) {
    super(message);
    this.name = "AppError";
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, requestId?: string) {
    super("VALIDATION_ERROR", 400, message, requestId);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, requestId?: string) {
    super("NOT_FOUND", 404, message, requestId);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends AppError {
  constructor(message: string, requestId?: string) {
    super("CONFLICT", 409, message, requestId);
    this.name = "ConflictError";
  }
}

export class RateLimitError extends AppError {
  constructor(message: string, requestId?: string) {
    super("RATE_LIMIT_EXCEEDED", 429, message, requestId);
    this.name = "RateLimitError";
  }
}

export function errorHandler(
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const requestId = req.requestId || "unknown";

  if (err instanceof AppError) {
    logger.warn(
      {
        requestId,
        code: err.code,
        statusCode: err.statusCode,
        message: err.message,
      },
      "Application error"
    );

    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        requestId,
      },
    });
    return;
  }

  // Enhanced error logging with more details
  const errorDetails: Record<string, unknown> = {
    requestId,
    error: err.message,
    errorName: err.name,
    stack: err.stack,
  };

  // Add database error details if available
  if (err instanceof Error && "code" in err) {
    errorDetails.dbCode = (err as { code?: string }).code;
  }
  if (err instanceof Error && "detail" in err) {
    errorDetails.dbDetail = (err as { detail?: string }).detail;
  }
  if (err instanceof Error && "hint" in err) {
    errorDetails.dbHint = (err as { hint?: string }).hint;
  }
  if (err instanceof Error && "position" in err) {
    errorDetails.dbPosition = (err as { position?: string }).position;
  }

  logger.error(errorDetails, "Unexpected error");

  res.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred",
      requestId,
    },
  });
}

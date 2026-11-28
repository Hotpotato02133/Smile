import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { API_ERROR_CODES, type ApiErrorResponse } from "@smile/shared";
import type { Request, Response } from "express";

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = API_ERROR_CODES.INTERNAL_ERROR;
    let message = "An unexpected internal server error occurred.";
    let details: unknown;

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === "string") {
        message = body;
      } else if (body && typeof body === "object") {
        const record = body as Record<string, unknown>;
        if (typeof record.code === "string") {
          code = record.code;
        } else {
          code = this.mapStatusToCode(statusCode);
        }
        if (typeof record.message === "string") {
          message = record.message;
        } else if (Array.isArray(record.message)) {
          message = record.message.join("; ");
        }
        if (record.details !== undefined) {
          details = record.details;
        }
      } else {
        code = this.mapStatusToCode(statusCode);
      }
    } else {
      const errMessage =
        exception instanceof Error ? exception.message : String(exception);
      const errStack = exception instanceof Error ? exception.stack : undefined;
      this.logger.error(
        `Unhandled 500 on ${request.method} ${request.url}: ${errMessage}`,
        errStack
      );
    }

    const payload: ApiErrorResponse = {
      statusCode,
      code,
      message,
      ...(details !== undefined ? { details } : {}),
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    response.status(statusCode).json(payload);
  }

  private mapStatusToCode(status: number): string {
    switch (status) {
      case HttpStatus.UNAUTHORIZED:
        return API_ERROR_CODES.UNAUTHENTICATED;
      case HttpStatus.FORBIDDEN:
        return API_ERROR_CODES.FORBIDDEN;
      case HttpStatus.NOT_FOUND:
        return API_ERROR_CODES.NOT_FOUND;
      case HttpStatus.CONFLICT:
        return API_ERROR_CODES.CONFLICT;
      case HttpStatus.TOO_MANY_REQUESTS:
        return API_ERROR_CODES.RATE_LIMITED;
      case HttpStatus.BAD_REQUEST:
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return API_ERROR_CODES.INVALID_INPUT;
      default:
        return API_ERROR_CODES.INTERNAL_ERROR;
    }
  }
}

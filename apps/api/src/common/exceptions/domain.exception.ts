import { HttpException, HttpStatus } from "@nestjs/common";
import type { ApiErrorCode } from "@smile/shared";

/**
 * Structured domain error mirroring Smile's error codes (QUOTA_EXCEEDED,
 * CLINIC_READ_ONLY, SLOT_UNAVAILABLE, etc.) for predictable frontend toasts.
 */
export class DomainException extends HttpException {
  constructor(
    public readonly code: ApiErrorCode | string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    public readonly details?: unknown
  ) {
    super({ code, message, details }, status);
  }
}

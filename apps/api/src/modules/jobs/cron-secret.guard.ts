import { timingSafeEqual } from "node:crypto";
import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { API_ERROR_CODES } from "@smile/shared";
import type { Request } from "express";
import { DomainException } from "../../common/exceptions/domain.exception";
import type { AppEnv } from "../../config/env";

/**
 * Protects `POST /api/v1/internal/cron/*` endpoints invoked by GitHub Actions
 * scheduled workflows using constant-time comparison against `CRON_SECRET`.
 */
@Injectable()
export class CronSecretGuard implements CanActivate {
  constructor(private readonly configService: ConfigService<AppEnv, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.configService
      .get("CRON_SECRET", { infer: true })
      ?.trim();
    if (!expected) {
      throw new DomainException(
        API_ERROR_CODES.UNAUTHENTICATED,
        "CRON_SECRET is not configured on the server.",
        HttpStatus.UNAUTHORIZED
      );
    }

    const req = context.switchToHttp().getRequest<Request>();
    const headerVal = req.headers["x-cron-secret"];
    const provided = Array.isArray(headerVal) ? headerVal[0] : headerVal;
    if (!provided) {
      throw new DomainException(
        API_ERROR_CODES.UNAUTHENTICATED,
        "Missing X-Cron-Secret header.",
        HttpStatus.UNAUTHORIZED
      );
    }

    const a = Buffer.from(expected);
    const b = Buffer.from(provided);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new DomainException(
        API_ERROR_CODES.UNAUTHENTICATED,
        "Invalid cron secret.",
        HttpStatus.UNAUTHORIZED
      );
    }

    return true;
  }
}

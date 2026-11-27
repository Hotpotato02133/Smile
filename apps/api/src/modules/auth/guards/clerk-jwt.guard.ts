import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { API_ERROR_CODES } from "@smile/shared";
import {
  ALLOW_INACTIVE_USER_KEY,
  ALLOW_UNPROVISIONED_USER_KEY,
} from "../../../common/decorators/auth.decorators";
import { DomainException } from "../../../common/exceptions/domain.exception";
import type { AuthenticatedRequest } from "../../../common/types/request-context";
import { PrismaService } from "../../../infra/prisma.service";
import { ClerkService } from "../clerk.service";

/**
 * Law #2: Verifies the Clerk Bearer JWT and resolves the authoritative `users`
 * row from PostgreSQL (never trusting client-supplied userId, role, or clinicId).
 */
@Injectable()
export class ClerkJwtGuard implements CanActivate {
  constructor(
    private readonly clerkService: ClerkService,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new DomainException(
        API_ERROR_CODES.UNAUTHENTICATED,
        "Sign-in required.",
        HttpStatus.UNAUTHORIZED
      );
    }

    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) {
      throw new DomainException(
        API_ERROR_CODES.UNAUTHENTICATED,
        "Sign-in required.",
        HttpStatus.UNAUTHORIZED
      );
    }

    const identity = await this.clerkService.verifySessionToken(token);
    const user = await this.prisma.user.findUnique({
      where: { clerkId: identity.clerkId },
    });

    const allowUnprovisioned = this.reflector.getAllAndOverride<boolean>(
      ALLOW_UNPROVISIONED_USER_KEY,
      [context.getHandler(), context.getClass()]
    );
    const allowInactive = this.reflector.getAllAndOverride<boolean>(
      ALLOW_INACTIVE_USER_KEY,
      [context.getHandler(), context.getClass()]
    );

    if (!user && !allowUnprovisioned) {
      throw new DomainException(
        API_ERROR_CODES.FORBIDDEN,
        "User account is inactive or missing.",
        HttpStatus.FORBIDDEN
      );
    }

    if (user && !user.isActive && !allowInactive) {
      throw new DomainException(
        API_ERROR_CODES.FORBIDDEN,
        "User account is inactive or missing.",
        HttpStatus.FORBIDDEN
      );
    }

    req.auth = { identity, user };
    return true;
  }
}

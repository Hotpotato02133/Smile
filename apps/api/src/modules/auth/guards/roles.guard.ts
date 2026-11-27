import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import { API_ERROR_CODES, type UserRole } from "@smile/shared";
import {
  REQUIRE_ROOT_SUPER_ADMIN_KEY,
  ROLES_KEY,
} from "../../../common/decorators/auth.decorators";
import { DomainException } from "../../../common/exceptions/domain.exception";
import type { AuthenticatedRequest } from "../../../common/types/request-context";
import type { AppEnv } from "../../../config/env";

/**
 * Enforces 5-tier RBAC (`@Roles(...)`) and Law #3 (`@RequireRootSuperAdmin()`).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService<AppEnv, true>
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()]
    );
    const requireRootOwner = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_ROOT_SUPER_ADMIN_KEY,
      [context.getHandler(), context.getClass()]
    );

    if (!requiredRoles?.length && !requireRootOwner) {
      return true;
    }

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = req.auth?.user;
    if (!user || !user.isActive) {
      throw new DomainException(
        API_ERROR_CODES.FORBIDDEN,
        "User account is inactive or missing.",
        HttpStatus.FORBIDDEN
      );
    }

    if (requireRootOwner) {
      const ownerEmail = this.configService
        .get("SUPER_ADMIN_EMAIL", { infer: true })
        ?.trim()
        .toLowerCase();
      const isRoot =
        user.role === "super_admin" &&
        Boolean(ownerEmail) &&
        user.email.trim().toLowerCase() === ownerEmail;
      if (!isRoot) {
        throw new DomainException(
          API_ERROR_CODES.FORBIDDEN,
          "Only the primary Platform Owner (SUPER_ADMIN_EMAIL) may perform this action.",
          HttpStatus.FORBIDDEN
        );
      }
    }

    if (requiredRoles?.length && !requiredRoles.includes(user.role as UserRole)) {
      throw new DomainException(
        API_ERROR_CODES.FORBIDDEN,
        requiredRoles.includes("super_admin") && requiredRoles.length === 1
          ? "Super Admin privileges required."
          : "Insufficient role permissions for this operation.",
        HttpStatus.FORBIDDEN
      );
    }

    return true;
  }
}

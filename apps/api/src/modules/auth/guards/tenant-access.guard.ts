import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { API_ERROR_CODES, type UserRole } from "@smile/shared";
import { CLINIC_ACCESS_ROLES_KEY } from "../../../common/decorators/auth.decorators";
import { DomainException } from "../../../common/exceptions/domain.exception";
import type { AuthenticatedRequest } from "../../../common/types/request-context";
import { PrismaService } from "../../../infra/prisma.service";

const READ_ONLY_HTTP_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Law #1 & Law #2: Derives `clinicId` strictly from the authenticated user's
 * DB record. Supports Super Admin read-only `?overrideClinicId` View-As-Clinic mode.
 */
@Injectable()
export class TenantAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const allowedRoles = this.reflector.getAllAndOverride<UserRole[] | undefined>(
      CLINIC_ACCESS_ROLES_KEY,
      [context.getHandler(), context.getClass()]
    );
    if (!allowedRoles) {
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

    const overrideClinicId =
      typeof req.query?.overrideClinicId === "string" &&
      req.query.overrideClinicId.trim()
        ? req.query.overrideClinicId.trim()
        : undefined;

    // Super Admin View-As-Clinic mode (strictly read-only on non-GET requests)
    if (user.role === "super_admin" && overrideClinicId) {
      if (!READ_ONLY_HTTP_METHODS.has(req.method.toUpperCase())) {
        throw new DomainException(
          API_ERROR_CODES.READ_ONLY_IMPERSONATION,
          "Super Admin View-As-Clinic mode is strictly read-only.",
          HttpStatus.FORBIDDEN
        );
      }

      const clinic = await this.prisma.clinic.findUnique({
        where: { id: overrideClinicId },
      });
      if (!clinic) {
        throw new DomainException(
          API_ERROR_CODES.NOT_FOUND,
          "Target clinic not found.",
          HttpStatus.NOT_FOUND
        );
      }

      req.tenant = {
        clinicId: clinic.id,
        clinic,
        isSuperAdminOverride: true,
      };
      return true;
    }

    if (!allowedRoles.includes(user.role as UserRole) || !user.clinicId) {
      throw new DomainException(
        API_ERROR_CODES.FORBIDDEN,
        "Insufficient role permissions for this clinic operation.",
        HttpStatus.FORBIDDEN
      );
    }

    const clinic = await this.prisma.clinic.findUnique({
      where: { id: user.clinicId },
    });
    if (!clinic) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Assigned clinic does not exist.",
        HttpStatus.NOT_FOUND
      );
    }

    req.tenant = {
      clinicId: clinic.id,
      clinic,
      isSuperAdminOverride: false,
    };
    return true;
  }
}

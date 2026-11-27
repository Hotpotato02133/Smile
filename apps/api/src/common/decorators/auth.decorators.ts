import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from "@nestjs/common";
import type { UserRole } from "@smile/shared";
import type {
  AuthContext,
  AuthenticatedRequest,
  TenantContext,
} from "../types/request-context";

export const ROLES_KEY = "smile:roles";
export const ALLOW_INACTIVE_USER_KEY = "smile:allow_inactive_user";
export const ALLOW_UNPROVISIONED_USER_KEY = "smile:allow_unprovisioned_user";
export const REQUIRE_ROOT_SUPER_ADMIN_KEY = "smile:require_root_super_admin";
export const CLINIC_ACCESS_ROLES_KEY = "smile:clinic_access_roles";
export const AUDIT_LOG_METADATA_KEY = "smile:audit_log";

export interface AuditLogMetadata {
  actionType: string;
  targetEntity: string;
}

export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

export const AllowInactiveUser = () =>
  SetMetadata(ALLOW_INACTIVE_USER_KEY, true);

export const AllowUnprovisionedUser = () =>
  SetMetadata(ALLOW_UNPROVISIONED_USER_KEY, true);

export const RequireRootSuperAdmin = () =>
  SetMetadata(REQUIRE_ROOT_SUPER_ADMIN_KEY, true);

export const RequireClinicAccess = (
  allowedRoles: UserRole[] = ["clinic_admin", "dentist", "receptionist"]
) => SetMetadata(CLINIC_ACCESS_ROLES_KEY, allowedRoles);

export const AuditLog = (actionType: string, targetEntity: string) =>
  SetMetadata(AUDIT_LOG_METADATA_KEY, {
    actionType,
    targetEntity,
  } satisfies AuditLogMetadata);

export const CurrentAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext | undefined => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return req.auth;
  }
);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return req.auth?.user ?? null;
  }
);

export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TenantContext | undefined => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return req.tenant;
  }
);

import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Clinic, SubscriptionPlan } from "@prisma/client";
import {
  API_ERROR_CODES,
  type ClinicFeatureFlag,
  type ClinicFeatureFlags,
  GRACE_PERIOD_MS,
} from "@smile/shared";
import { DomainException } from "../../../common/exceptions/domain.exception";
import type { AuthenticatedRequest } from "../../../common/types/request-context";
import { PrismaService } from "../../../infra/prisma.service";

export type ClinicResourceType =
  | "appointment"
  | "dentist"
  | "chair"
  | "storage"
  | "email"
  | "staff";

export const REQUIRE_CLINIC_WRITE_KEY = "smile:require_clinic_write";
export const REQUIRE_CLINIC_FEATURE_KEY = "smile:require_clinic_feature";

const FEATURE_LABELS: Record<ClinicFeatureFlag, string> = {
  odontogramEnabled: "Interactive 32-Tooth Odontogram",
  xrayStorageEnabled: "X-Ray & Intraoral Photo Vault",
  waitlistAutomationEnabled: "Waitlist Cancellation Blast",
  recallAutomationEnabled: "6-Month Hygiene Recall Automation",
  customBrandingEnabled: "Custom Clinic Branding",
};

export const RequireClinicWrite = (resourceType: ClinicResourceType = "staff") =>
  SetMetadata(REQUIRE_CLINIC_WRITE_KEY, resourceType);

export const RequireClinicFeature = (feature: ClinicFeatureFlag) =>
  SetMetadata(REQUIRE_CLINIC_FEATURE_KEY, feature);

/**
 * Reusable Law #4 subscription status & resource quota assertion.
 * Can be called inside transactional services as well as via `ClinicQuotaGuard`.
 */
export function assertClinicCanWriteResource(
  clinic: Clinic,
  plan: SubscriptionPlan,
  resourceType: ClinicResourceType,
  nowMs: number = Date.now()
): void {
  if (clinic.status === "suspended" || clinic.status === "archived") {
    throw new DomainException(
      API_ERROR_CODES.CLINIC_READ_ONLY,
      "This clinic is in read-only mode. Please renew the subscription.",
      HttpStatus.FORBIDDEN
    );
  }

  const subEndMs = clinic.subscriptionEndsAt.getTime();
  if (clinic.status === "trial" && nowMs > subEndMs) {
    throw new DomainException(
      API_ERROR_CODES.SUBSCRIPTION_EXPIRED,
      "The free trial has ended. Please upgrade to continue.",
      HttpStatus.FORBIDDEN
    );
  }
  if (clinic.status === "active" && nowMs > subEndMs) {
    throw new DomainException(
      API_ERROR_CODES.SUBSCRIPTION_EXPIRED,
      "The subscription has expired. Please renew.",
      HttpStatus.FORBIDDEN
    );
  }
  if (clinic.status === "past_due") {
    const graceEndMs =
      clinic.gracePeriodEndsAt?.getTime() ?? subEndMs + GRACE_PERIOD_MS;
    if (nowMs > graceEndMs) {
      throw new DomainException(
        API_ERROR_CODES.CLINIC_READ_ONLY,
        "The grace period has ended. The clinic is read-only.",
        HttpStatus.FORBIDDEN
      );
    }
  }

  const quotaError = (message: string) =>
    new DomainException(
      API_ERROR_CODES.QUOTA_EXCEEDED,
      message,
      HttpStatus.FORBIDDEN
    );

  switch (resourceType) {
    case "dentist":
      if (clinic.activeDentistCount >= plan.maxDentists) {
        throw quotaError(
          `${plan.name} plan allows up to ${plan.maxDentists} dentists.`
        );
      }
      break;
    case "chair":
      if (clinic.activeChairCount >= plan.maxChairs) {
        throw quotaError(
          `${plan.name} plan allows up to ${plan.maxChairs} chairs.`
        );
      }
      break;
    case "appointment":
      if (clinic.currentMonthAppointmentCount >= plan.maxAppointmentsPerMonth) {
        throw quotaError(
          `${plan.name} plan allows up to ${plan.maxAppointmentsPerMonth} appointments per month.`
        );
      }
      break;
    case "storage":
      if (clinic.storageUsedBytes >= plan.maxStorageBytes) {
        throw quotaError("Storage quota reached. Please upgrade your plan.");
      }
      break;
    case "email":
      if (clinic.currentMonthEmailCount >= plan.maxEmailsPerMonth) {
        throw quotaError("Monthly email quota reached.");
      }
      break;
    case "staff":
      break;
  }
}

export function assertClinicFeature(
  clinic: Clinic,
  feature: ClinicFeatureFlag
): void {
  const flags = clinic.featureFlags as unknown as Partial<ClinicFeatureFlags>;
  if (!flags?.[feature]) {
    throw new DomainException(
      API_ERROR_CODES.FEATURE_DISABLED,
      `${FEATURE_LABELS[feature]} is not enabled on this clinic's current plan.`,
      HttpStatus.FORBIDDEN
    );
  }
}

/**
 * Guard enforcing `@RequireClinicWrite(resourceType)` and `@RequireClinicFeature(feature)`.
 * Must run after `ClerkJwtGuard` and `TenantAccessGuard`.
 */
@Injectable()
export class ClinicQuotaGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const resourceType = this.reflector.getAllAndOverride<
      ClinicResourceType | undefined
    >(REQUIRE_CLINIC_WRITE_KEY, [context.getHandler(), context.getClass()]);
    const requiredFeature = this.reflector.getAllAndOverride<
      ClinicFeatureFlag | undefined
    >(REQUIRE_CLINIC_FEATURE_KEY, [context.getHandler(), context.getClass()]);

    if (!resourceType && !requiredFeature) {
      return true;
    }

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const tenant = req.tenant;
    if (!tenant) {
      throw new DomainException(
        API_ERROR_CODES.FORBIDDEN,
        "Clinic tenant context is required.",
        HttpStatus.FORBIDDEN
      );
    }

    if (resourceType && tenant.isSuperAdminOverride) {
      throw new DomainException(
        API_ERROR_CODES.READ_ONLY_IMPERSONATION,
        "Super Admin View-As-Clinic mode is strictly read-only.",
        HttpStatus.FORBIDDEN
      );
    }

    if (requiredFeature) {
      assertClinicFeature(tenant.clinic, requiredFeature);
    }

    if (resourceType) {
      const plan = await this.prisma.subscriptionPlan.findUnique({
        where: { id: tenant.clinic.planId },
      });
      if (!plan) {
        throw new DomainException(
          API_ERROR_CODES.NOT_FOUND,
          "Subscription plan not found.",
          HttpStatus.NOT_FOUND
        );
      }
      assertClinicCanWriteResource(tenant.clinic, plan, resourceType);
    }

    return true;
  }
}

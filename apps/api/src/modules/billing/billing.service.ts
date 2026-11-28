import { HttpStatus, Injectable } from "@nestjs/common";
import {
  ClinicStatus,
  PaymentStatus,
  type Prisma,
  type User,
} from "@prisma/client";
import { API_ERROR_CODES } from "@smile/shared";
import { DomainException } from "../../common/exceptions/domain.exception";
import { generateInvoiceNumber } from "../../common/utils/manila-time";
import { PrismaService } from "../../infra/prisma.service";
import { AuditService } from "../audit/audit.service";
import { StorageService } from "../storage/storage.service";
import { serializePlan } from "../super-admin/super-admin.service";
import type {
  RecordPaymentDto,
  UpdatePaymentStatusDto,
  UpsertPlanDto,
} from "./billing.schemas";

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly storageService: StorageService
  ) {}

  async listPlans() {
    const plans = await this.prisma.subscriptionPlan.findMany({
      orderBy: { monthlyPricePhp: "asc" },
    });
    return plans.map(serializePlan);
  }

  async createPlan(actor: User, dto: UpsertPlanDto) {
    const duplicate = await this.prisma.subscriptionPlan.findUnique({
      where: { code: dto.code },
    });
    if (duplicate) {
      throw new DomainException(
        API_ERROR_CODES.CONFLICT,
        `A subscription plan with code "${dto.code}" already exists.`,
        HttpStatus.CONFLICT
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.subscriptionPlan.create({
        data: {
          code: dto.code,
          name: dto.name,
          description: dto.description,
          monthlyPricePhp: dto.monthlyPricePhp,
          annualPricePhp: dto.annualPricePhp,
          trialDays: dto.trialDays,
          maxDentists: dto.maxDentists,
          maxChairs: dto.maxChairs,
          maxAppointmentsPerMonth: dto.maxAppointmentsPerMonth,
          maxStorageBytes: BigInt(dto.maxStorageBytes),
          maxEmailsPerMonth: dto.maxEmailsPerMonth,
          defaultFeatures: dto.defaultFeatures as unknown as Prisma.InputJsonValue,
          isActive: dto.isActive,
        },
      });

      await this.auditService.record(
        {
          actorUserId: actor.id,
          actorRole: actor.role,
          actionType: "SUBSCRIPTION_PLAN_CREATED",
          targetEntity: "subscription_plans",
          targetId: plan.id,
          metadata: {
            code: plan.code,
            name: plan.name,
            monthlyPricePhp: plan.monthlyPricePhp,
          },
        },
        tx
      );
      return serializePlan(plan);
    });
  }

  async updatePlan(actor: User, planId: string, dto: UpsertPlanDto) {
    const existing = await this.prisma.subscriptionPlan.findUnique({
      where: { id: planId },
    });
    if (!existing) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Subscription plan not found.",
        HttpStatus.NOT_FOUND
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.subscriptionPlan.update({
        where: { id: planId },
        data: {
          code: dto.code,
          name: dto.name,
          description: dto.description,
          monthlyPricePhp: dto.monthlyPricePhp,
          annualPricePhp: dto.annualPricePhp,
          trialDays: dto.trialDays,
          maxDentists: dto.maxDentists,
          maxChairs: dto.maxChairs,
          maxAppointmentsPerMonth: dto.maxAppointmentsPerMonth,
          maxStorageBytes: BigInt(dto.maxStorageBytes),
          maxEmailsPerMonth: dto.maxEmailsPerMonth,
          defaultFeatures: dto.defaultFeatures as unknown as Prisma.InputJsonValue,
          isActive: dto.isActive,
        },
      });

      await this.auditService.record(
        {
          actorUserId: actor.id,
          actorRole: actor.role,
          actionType: "SUBSCRIPTION_PLAN_UPDATED",
          targetEntity: "subscription_plans",
          targetId: plan.id,
          metadata: {
            code: plan.code,
            name: plan.name,
            monthlyPricePhp: plan.monthlyPricePhp,
          },
        },
        tx
      );
      return serializePlan(plan);
    });
  }

  async listPayments(filters: {
    clinicId?: string;
    status?: PaymentStatus;
    limit?: number;
  }) {
    const take = Math.min(Math.max(filters.limit ?? 50, 1), 200);
    const payments = await this.prisma.subscriptionPayment.findMany({
      where: {
        ...(filters.clinicId ? { clinicId: filters.clinicId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
      },
      include: {
        clinic: { select: { id: true, name: true, slug: true } },
        plan: { select: { id: true, code: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take,
    });

    return Promise.all(
      payments.map(async (p) => ({
        ...p,
        clinicName: p.clinic.name,
        clinicSlug: p.clinic.slug,
        planName: p.plan.name,
        planCode: p.plan.code,
        receiptUrl:
          p.receiptStorageKey && this.storageService.isConfigured
            ? await this.storageService
                .createPresignedGetUrl(p.receiptStorageKey, 300)
                .catch(() => null)
            : null,
      }))
    );
  }

  async recordPayment(actor: User, dto: RecordPaymentDto) {
    const [clinic, plan] = await Promise.all([
      this.prisma.clinic.findUnique({ where: { id: dto.clinicId } }),
      this.prisma.subscriptionPlan.findUnique({ where: { id: dto.planId } }),
    ]);

    if (!clinic) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Clinic not found.",
        HttpStatus.NOT_FOUND
      );
    }
    if (!plan) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Subscription plan not found.",
        HttpStatus.NOT_FOUND
      );
    }

    const now = new Date();
    const invoiceNumber = generateInvoiceNumber(now);

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.subscriptionPayment.create({
        data: {
          clinicId: clinic.id,
          planId: plan.id,
          invoiceNumber,
          amountPhp: dto.amountPhp,
          billingCycle: dto.billingCycle,
          paymentMethod: dto.paymentMethod,
          referenceNumber: dto.referenceNumber ?? null,
          receiptStorageKey: dto.receiptStorageKey ?? null,
          periodStart: dto.periodStart,
          periodEnd: dto.periodEnd,
          status: dto.status,
          notes: dto.notes ?? null,
          recordedByUserId: actor.id,
          paidAt: dto.status === PaymentStatus.paid ? now : null,
        },
      });

      if (dto.status === PaymentStatus.paid) {
        await tx.clinic.update({
          where: { id: clinic.id },
          data: {
            planId: plan.id,
            status: ClinicStatus.active,
            billingCycle: dto.billingCycle,
            subscriptionStartsAt: dto.periodStart,
            subscriptionEndsAt: dto.periodEnd,
            gracePeriodEndsAt: null,
            ...(dto.syncDefaultFeatures
              ? { featureFlags: plan.defaultFeatures as Prisma.InputJsonValue }
              : {}),
          },
        });
      }

      await this.auditService.record(
        {
          actorUserId: actor.id,
          actorRole: actor.role,
          clinicId: clinic.id,
          actionType: "SUBSCRIPTION_PAYMENT_RECORDED",
          targetEntity: "subscription_payments",
          targetId: payment.id,
          metadata: {
            invoiceNumber,
            amountPhp: dto.amountPhp,
            billingCycle: dto.billingCycle,
            paymentMethod: dto.paymentMethod,
            status: dto.status,
          },
        },
        tx
      );

      return payment;
    });
  }

  async updatePaymentStatus(
    actor: User,
    paymentId: string,
    dto: UpdatePaymentStatusDto
  ) {
    const existing = await this.prisma.subscriptionPayment.findUnique({
      where: { id: paymentId },
      include: { plan: true },
    });
    if (!existing) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Payment record not found.",
        HttpStatus.NOT_FOUND
      );
    }

    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.subscriptionPayment.update({
        where: { id: paymentId },
        data: {
          status: dto.status,
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          ...(dto.status === PaymentStatus.paid && !existing.paidAt
            ? { paidAt: now }
            : {}),
        },
      });

      if (
        dto.status === PaymentStatus.paid &&
        existing.status !== PaymentStatus.paid
      ) {
        await tx.clinic.update({
          where: { id: existing.clinicId },
          data: {
            planId: existing.planId,
            status: ClinicStatus.active,
            billingCycle: existing.billingCycle,
            subscriptionStartsAt: existing.periodStart,
            subscriptionEndsAt: existing.periodEnd,
            gracePeriodEndsAt: null,
          },
        });
      }

      await this.auditService.record(
        {
          actorUserId: actor.id,
          actorRole: actor.role,
          clinicId: existing.clinicId,
          actionType: "SUBSCRIPTION_PAYMENT_STATUS_UPDATED",
          targetEntity: "subscription_payments",
          targetId: paymentId,
          metadata: {
            invoiceNumber: existing.invoiceNumber,
            previousStatus: existing.status,
            nextStatus: dto.status,
          },
        },
        tx
      );

      return updated;
    });
  }
}

import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { PaymentStatus, User } from "@prisma/client";
import { CurrentUser, Roles } from "../../common/decorators/auth.decorators";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { ClerkJwtGuard } from "../auth/guards/clerk-jwt.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import {
  type RecordPaymentDto,
  recordPaymentSchema,
  type UpdatePaymentStatusDto,
  updatePaymentStatusSchema,
  type UpsertPlanDto,
  upsertPlanSchema,
} from "./billing.schemas";
import { BillingService } from "./billing.service";

@ApiTags("Billing & Plans")
@ApiBearerAuth("clerk-jwt")
@Controller("super-admin")
@UseGuards(ClerkJwtGuard, RolesGuard)
@Roles("super_admin")
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get("plans")
  @ApiOperation({ summary: "List subscription plans ordered by monthly price" })
  listPlans() {
    return this.billingService.listPlans();
  }

  @Post("plans")
  @ApiOperation({ summary: "Create a new subscription plan tier" })
  createPlan(
    @CurrentUser() actor: User,
    @Body(new ZodValidationPipe(upsertPlanSchema)) dto: UpsertPlanDto
  ) {
    return this.billingService.createPlan(actor, dto);
  }

  @Put("plans/:id")
  @ApiOperation({ summary: "Update an existing subscription plan tier" })
  updatePlan(
    @CurrentUser() actor: User,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(upsertPlanSchema)) dto: UpsertPlanDto
  ) {
    return this.billingService.updatePlan(actor, id, dto);
  }

  @Get("payments")
  @ApiOperation({ summary: "List subscription payment ledger records" })
  listPayments(
    @Query("clinicId") clinicId?: string,
    @Query("status") status?: PaymentStatus,
    @Query("limit") limit?: string
  ) {
    return this.billingService.listPayments({
      clinicId,
      status,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post("payments")
  @ApiOperation({ summary: "Record a clinic subscription payment and activate/renew plan" })
  recordPayment(
    @CurrentUser() actor: User,
    @Body(new ZodValidationPipe(recordPaymentSchema)) dto: RecordPaymentDto
  ) {
    return this.billingService.recordPayment(actor, dto);
  }

  @Patch("payments/:id/status")
  @ApiOperation({ summary: "Update payment status (paid/pending/overdue/refunded)" })
  updatePaymentStatus(
    @CurrentUser() actor: User,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updatePaymentStatusSchema))
    dto: UpdatePaymentStatusDto
  ) {
    return this.billingService.updatePaymentStatus(actor, id, dto);
  }
}

import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { User } from "@prisma/client";
import {
  CurrentTenant,
  CurrentUser,
  RequireClinicAccess,
} from "../../common/decorators/auth.decorators";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import type { TenantContext } from "../../common/types/request-context";
import { ClerkJwtGuard } from "../auth/guards/clerk-jwt.guard";
import {
  ClinicQuotaGuard,
  RequireClinicWrite,
} from "../auth/guards/clinic-quota.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { TenantAccessGuard } from "../auth/guards/tenant-access.guard";
import {
  type CreateWalkInBookingDto,
  createWalkInBookingSchema,
  type RescheduleAppointmentDto,
  rescheduleAppointmentSchema,
  type StaffAddWaitlistDto,
  staffAddWaitlistSchema,
  type TransitionAppointmentStatusDto,
  transitionAppointmentStatusSchema,
  type UpdateClinicalNotesDto,
  updateClinicalNotesSchema,
  type UpdateWaitlistStatusDto,
  updateWaitlistStatusSchema,
} from "./appointments.schemas";
import { AppointmentsService } from "./appointments.service";

@ApiTags("Appointments & Front Desk")
@ApiBearerAuth("clerk-jwt")
@Controller("appointments")
@UseGuards(ClerkJwtGuard, RolesGuard, TenantAccessGuard, ClinicQuotaGuard)
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Get("front-desk")
  @RequireClinicAccess(["receptionist", "clinic_admin", "dentist"])
  @ApiOperation({ summary: "Get front-desk daily schedule, Kanban queue, resources, and waitlist" })
  getFrontDesk(
    @CurrentTenant() tenant: TenantContext,
    @Query("dateKey") dateKey?: string
  ) {
    return this.appointmentsService.getFrontDeskWorkspace(tenant, dateKey);
  }

  @Get("dentist-queue")
  @RequireClinicAccess(["dentist", "clinic_admin"])
  @ApiOperation({ summary: "Get dentist daily patient queue" })
  getDentistQueue(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() actor: User,
    @Query("dateKey") dateKey?: string,
    @Query("dentistId") dentistId?: string
  ) {
    return this.appointmentsService.getDentistQueue(tenant, actor, {
      dateKey,
      dentistId,
    });
  }

  @Get("patients/search")
  @RequireClinicAccess(["receptionist", "clinic_admin", "dentist"])
  @ApiOperation({ summary: "Search clinic patients by name, phone, or email" })
  searchPatients(
    @CurrentTenant() tenant: TenantContext,
    @Query("q") q?: string
  ) {
    return this.appointmentsService.searchPatients(tenant, q);
  }

  @Post("walk-in")
  @RequireClinicAccess(["receptionist", "clinic_admin", "dentist"])
  @RequireClinicWrite("appointment")
  @ApiOperation({
    summary:
      "Create a concurrency-safe front-desk walk-in or phone booking (FOR UPDATE + GIST)",
  })
  createWalkIn(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() actor: User,
    @Body(new ZodValidationPipe(createWalkInBookingSchema))
    dto: CreateWalkInBookingDto
  ) {
    return this.appointmentsService.createWalkInBooking(tenant, actor, dto);
  }

  @Patch(":id/status")
  @RequireClinicAccess(["receptionist", "clinic_admin", "dentist"])
  @RequireClinicWrite("staff")
  @ApiOperation({
    summary: "Transition appointment status (emits real-time Socket.IO event)",
  })
  transitionStatus(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() actor: User,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(transitionAppointmentStatusSchema))
    dto: TransitionAppointmentStatusDto
  ) {
    return this.appointmentsService.transitionStatus(tenant, actor, id, dto);
  }

  @Patch(":id/reschedule")
  @RequireClinicAccess(["receptionist", "clinic_admin", "dentist"])
  @RequireClinicWrite("staff")
  @ApiOperation({ summary: "Concurrency-safe dual-resource appointment reschedule" })
  reschedule(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() actor: User,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(rescheduleAppointmentSchema))
    dto: RescheduleAppointmentDto
  ) {
    return this.appointmentsService.rescheduleAppointment(tenant, actor, id, dto);
  }

  @Patch(":id/clinical-notes")
  @RequireClinicAccess(["dentist", "clinic_admin"])
  @RequireClinicWrite("staff")
  @ApiOperation({ summary: "Save dentist clinical notes and post-visit instructions" })
  updateClinicalNotes(
    @CurrentTenant() tenant: TenantContext,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateClinicalNotesSchema))
    dto: UpdateClinicalNotesDto
  ) {
    return this.appointmentsService.updateClinicalNotes(tenant, id, dto);
  }

  @Post("waitlist")
  @RequireClinicAccess(["receptionist", "clinic_admin"])
  @RequireClinicWrite("staff")
  @ApiOperation({ summary: "Add a patient to the clinic cancellation waitlist" })
  addWaitlist(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(staffAddWaitlistSchema))
    dto: StaffAddWaitlistDto
  ) {
    return this.appointmentsService.addWaitlistEntry(tenant, dto);
  }

  @Patch("waitlist/:id/status")
  @RequireClinicAccess(["receptionist", "clinic_admin"])
  @RequireClinicWrite("staff")
  @ApiOperation({ summary: "Update a waitlist entry status" })
  updateWaitlistStatus(
    @CurrentTenant() tenant: TenantContext,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateWaitlistStatusSchema))
    dto: UpdateWaitlistStatusDto
  ) {
    return this.appointmentsService.updateWaitlistStatus(tenant, id, dto);
  }
}

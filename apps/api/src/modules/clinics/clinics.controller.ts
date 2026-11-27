import {
  Body,
  Controller,
  Delete,
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
  type AddDentistTimeOffDto,
  addDentistTimeOffSchema,
  type CreateChairDto,
  createChairSchema,
  type CreateDentistDto,
  createDentistSchema,
  type CreateServiceDto,
  createServiceSchema,
  type InviteClinicStaffDto,
  inviteClinicStaffSchema,
  type UpdateChairDto,
  updateChairSchema,
  type UpdateClinicSettingsDto,
  updateClinicSettingsSchema,
  type UpdateDentistDto,
  updateDentistSchema,
  type UpdateServiceDto,
  updateServiceSchema,
} from "./clinics.schemas";
import { ClinicsService } from "./clinics.service";

@ApiTags("Clinic Resources & Operations")
@ApiBearerAuth("clerk-jwt")
@Controller("clinic")
@UseGuards(ClerkJwtGuard, RolesGuard, TenantAccessGuard, ClinicQuotaGuard)
export class ClinicsController {
  constructor(private readonly clinicsService: ClinicsService) {}

  @Get("workspace")
  @RequireClinicAccess(["clinic_admin", "dentist", "receptionist"])
  @ApiOperation({ summary: "Get clinic workspace state, plan, read-only status, and announcements" })
  getWorkspace(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() actor: User
  ) {
    return this.clinicsService.getWorkspace(tenant, actor);
  }

  @Get("billing")
  @RequireClinicAccess(["clinic_admin"])
  @ApiOperation({ summary: "Get clinic plan quotas and payment history" })
  getBillingSummary(@CurrentTenant() tenant: TenantContext) {
    return this.clinicsService.getBillingSummary(tenant);
  }

  @Get("metrics/daily")
  @RequireClinicAccess(["clinic_admin"])
  @ApiOperation({ summary: "Get clinic daily appointment & revenue metrics for charts" })
  getDailyMetrics(
    @CurrentTenant() tenant: TenantContext,
    @Query("days") days?: string
  ) {
    return this.clinicsService.getDailyMetrics(tenant, days ? Number(days) : 30);
  }

  @Patch("settings")
  @RequireClinicAccess(["clinic_admin"])
  @RequireClinicWrite("staff")
  @ApiOperation({ summary: "Update clinic settings, operating hours, and booking policies" })
  updateSettings(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() actor: User,
    @Body(new ZodValidationPipe(updateClinicSettingsSchema))
    dto: UpdateClinicSettingsDto
  ) {
    return this.clinicsService.updateSettings(tenant, actor, dto);
  }

  // --- Dentists ---

  @Get("dentists")
  @RequireClinicAccess(["clinic_admin", "dentist", "receptionist"])
  @ApiOperation({ summary: "List clinic dentists and upcoming time-off blocks" })
  listDentists(@CurrentTenant() tenant: TenantContext) {
    return this.clinicsService.listDentists(tenant);
  }

  @Post("dentists")
  @RequireClinicAccess(["clinic_admin"])
  @RequireClinicWrite("dentist")
  @ApiOperation({ summary: "Create a dentist profile (enforces plan maxDentists quota)" })
  createDentist(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() actor: User,
    @Body(new ZodValidationPipe(createDentistSchema)) dto: CreateDentistDto
  ) {
    return this.clinicsService.createDentist(tenant, actor, dto);
  }

  @Patch("dentists/:id")
  @RequireClinicAccess(["clinic_admin", "dentist"])
  @RequireClinicWrite("staff")
  @ApiOperation({ summary: "Update dentist profile or weekly schedule" })
  updateDentist(
    @CurrentTenant() tenant: TenantContext,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateDentistSchema)) dto: UpdateDentistDto
  ) {
    return this.clinicsService.updateDentist(tenant, id, dto);
  }

  @Patch("dentists/:id/toggle")
  @RequireClinicAccess(["clinic_admin"])
  @RequireClinicWrite("staff")
  @ApiOperation({ summary: "Activate or deactivate a dentist profile" })
  toggleDentist(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() actor: User,
    @Param("id") id: string
  ) {
    return this.clinicsService.toggleDentistActive(tenant, actor, id);
  }

  @Post("dentists/:id/time-off")
  @RequireClinicAccess(["clinic_admin", "dentist"])
  @RequireClinicWrite("staff")
  @ApiOperation({ summary: "Block time-off for a dentist" })
  addTimeOff(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() actor: User,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(addDentistTimeOffSchema)) dto: AddDentistTimeOffDto
  ) {
    return this.clinicsService.addDentistTimeOff(tenant, actor, id, dto);
  }

  @Delete("dentists/time-off/:timeOffId")
  @RequireClinicAccess(["clinic_admin", "dentist"])
  @RequireClinicWrite("staff")
  @ApiOperation({ summary: "Remove a dentist time-off block" })
  deleteTimeOff(
    @CurrentTenant() tenant: TenantContext,
    @Param("timeOffId") timeOffId: string
  ) {
    return this.clinicsService.deleteDentistTimeOff(tenant, timeOffId);
  }

  // --- Chairs ---

  @Get("chairs")
  @RequireClinicAccess(["clinic_admin", "dentist", "receptionist"])
  @ApiOperation({ summary: "List clinic operatory chairs" })
  listChairs(@CurrentTenant() tenant: TenantContext) {
    return this.clinicsService.listChairs(tenant);
  }

  @Post("chairs")
  @RequireClinicAccess(["clinic_admin"])
  @RequireClinicWrite("chair")
  @ApiOperation({ summary: "Create an operatory chair (enforces plan maxChairs quota)" })
  createChair(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() actor: User,
    @Body(new ZodValidationPipe(createChairSchema)) dto: CreateChairDto
  ) {
    return this.clinicsService.createChair(tenant, actor, dto);
  }

  @Patch("chairs/:id")
  @RequireClinicAccess(["clinic_admin"])
  @RequireClinicWrite("staff")
  @ApiOperation({ summary: "Update an operatory chair" })
  updateChair(
    @CurrentTenant() tenant: TenantContext,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateChairSchema)) dto: UpdateChairDto
  ) {
    return this.clinicsService.updateChair(tenant, id, dto);
  }

  @Patch("chairs/:id/toggle")
  @RequireClinicAccess(["clinic_admin"])
  @RequireClinicWrite("staff")
  @ApiOperation({ summary: "Activate or deactivate an operatory chair" })
  toggleChair(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() actor: User,
    @Param("id") id: string
  ) {
    return this.clinicsService.toggleChairActive(tenant, actor, id);
  }

  // --- Services ---

  @Get("services")
  @RequireClinicAccess(["clinic_admin", "dentist", "receptionist"])
  @ApiOperation({ summary: "List clinic dental services" })
  listServices(@CurrentTenant() tenant: TenantContext) {
    return this.clinicsService.listServices(tenant);
  }

  @Post("services")
  @RequireClinicAccess(["clinic_admin"])
  @RequireClinicWrite("staff")
  @ApiOperation({ summary: "Create a dental service" })
  createService(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createServiceSchema)) dto: CreateServiceDto
  ) {
    return this.clinicsService.createService(tenant, dto);
  }

  @Patch("services/:id")
  @RequireClinicAccess(["clinic_admin"])
  @RequireClinicWrite("staff")
  @ApiOperation({ summary: "Update a dental service" })
  updateService(
    @CurrentTenant() tenant: TenantContext,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateServiceSchema)) dto: UpdateServiceDto
  ) {
    return this.clinicsService.updateService(tenant, id, dto);
  }

  @Patch("services/:id/toggle")
  @RequireClinicAccess(["clinic_admin"])
  @RequireClinicWrite("staff")
  @ApiOperation({ summary: "Toggle active status of a dental service" })
  toggleService(
    @CurrentTenant() tenant: TenantContext,
    @Param("id") id: string
  ) {
    return this.clinicsService.toggleServiceActive(tenant, id);
  }

  @Post("services/seed-defaults")
  @RequireClinicAccess(["clinic_admin"])
  @RequireClinicWrite("staff")
  @ApiOperation({ summary: "Seed missing default dental services from catalog" })
  seedDefaultServices(@CurrentTenant() tenant: TenantContext) {
    return this.clinicsService.seedDefaultServices(tenant);
  }

  // --- Staff & Invitations ---

  @Get("staff")
  @RequireClinicAccess(["clinic_admin"])
  @ApiOperation({ summary: "List clinic staff members and pending invitations" })
  listStaff(@CurrentTenant() tenant: TenantContext) {
    return this.clinicsService.listStaff(tenant);
  }

  @Post("staff/invitations")
  @RequireClinicAccess(["clinic_admin"])
  @RequireClinicWrite("staff")
  @ApiOperation({ summary: "Invite a clinic admin, dentist, or receptionist" })
  inviteStaff(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() actor: User,
    @Body(new ZodValidationPipe(inviteClinicStaffSchema))
    dto: InviteClinicStaffDto
  ) {
    return this.clinicsService.inviteStaff(tenant, actor, dto);
  }

  @Delete("staff/invitations/:id")
  @RequireClinicAccess(["clinic_admin"])
  @RequireClinicWrite("staff")
  @ApiOperation({ summary: "Revoke a pending clinic staff invitation" })
  revokeStaffInvitation(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() actor: User,
    @Param("id") id: string
  ) {
    return this.clinicsService.revokeStaffInvitation(tenant, actor, id);
  }

  @Patch("staff/:userId/toggle")
  @RequireClinicAccess(["clinic_admin"])
  @RequireClinicWrite("staff")
  @ApiOperation({ summary: "Deactivate or reactivate a clinic staff account" })
  toggleStaffActive(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() actor: User,
    @Param("userId") userId: string
  ) {
    return this.clinicsService.toggleStaffActive(tenant, actor, userId);
  }
}

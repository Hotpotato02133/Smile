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
import type {
  ClinicStatus,
  StaffInvitationStatus,
  User,
  UserRole,
} from "@prisma/client";
import { CurrentUser, Roles } from "../../common/decorators/auth.decorators";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { ClerkJwtGuard } from "../auth/guards/clerk-jwt.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import {
  type ChangeClinicPlanDto,
  changeClinicPlanSchema,
  type CreateAnnouncementDto,
  createAnnouncementSchema,
  type CreateClinicDto,
  createClinicSchema,
  type CreateRoleInvitationDto,
  createRoleInvitationSchema,
  type ExtendClinicSubscriptionDto,
  extendClinicSubscriptionSchema,
  type UpdateAnnouncementDto,
  updateAnnouncementSchema,
  type UpdateClinicDetailsDto,
  updateClinicDetailsSchema,
  type UpdateClinicFeaturesDto,
  updateClinicFeaturesSchema,
  type UpdateClinicStatusDto,
  updateClinicStatusSchema,
  type UpdateUserRoleOrStatusDto,
  updateUserRoleOrStatusSchema,
} from "./super-admin.schemas";
import { SuperAdminService } from "./super-admin.service";

@ApiTags("Super Admin")
@ApiBearerAuth("clerk-jwt")
@Controller("super-admin")
@UseGuards(ClerkJwtGuard, RolesGuard)
@Roles("super_admin")
export class SuperAdminController {
  constructor(private readonly superAdminService: SuperAdminService) {}

  @Get("clinics")
  @ApiOperation({ summary: "List all clinics with plan and quota counters" })
  listClinics(
    @Query("status") status?: ClinicStatus,
    @Query("planId") planId?: string,
    @Query("search") search?: string
  ) {
    return this.superAdminService.listClinics({ status, planId, search });
  }

  @Get("clinics/:id")
  @ApiOperation({ summary: "Get detailed clinic overview, staff, and payment history" })
  getClinicDetail(@Param("id") id: string) {
    return this.superAdminService.getClinicDetail(id);
  }

  @Post("clinics")
  @ApiOperation({ summary: "Provision a new dental clinic tenant and optional admin invite" })
  createClinic(
    @CurrentUser() actor: User,
    @Body(new ZodValidationPipe(createClinicSchema)) dto: CreateClinicDto
  ) {
    return this.superAdminService.createClinic(actor, dto);
  }

  @Patch("clinics/:id/details")
  @ApiOperation({ summary: "Update clinic profile and scheduling policies" })
  updateClinicDetails(
    @CurrentUser() actor: User,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateClinicDetailsSchema)) dto: UpdateClinicDetailsDto
  ) {
    return this.superAdminService.updateClinicDetails(actor, id, dto);
  }

  @Patch("clinics/:id/status")
  @ApiOperation({ summary: "Update clinic subscription status (active/past_due/suspended/archived)" })
  updateClinicStatus(
    @CurrentUser() actor: User,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateClinicStatusSchema)) dto: UpdateClinicStatusDto
  ) {
    return this.superAdminService.updateClinicStatus(actor, id, dto);
  }

  @Patch("clinics/:id/plan")
  @ApiOperation({ summary: "Change clinic subscription plan tier" })
  changeClinicPlan(
    @CurrentUser() actor: User,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(changeClinicPlanSchema)) dto: ChangeClinicPlanDto
  ) {
    return this.superAdminService.changeClinicPlan(actor, id, dto);
  }

  @Patch("clinics/:id/features")
  @ApiOperation({ summary: "Override per-clinic feature flags" })
  updateClinicFeatures(
    @CurrentUser() actor: User,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateClinicFeaturesSchema)) dto: UpdateClinicFeaturesDto
  ) {
    return this.superAdminService.updateClinicFeatures(actor, id, dto);
  }

  @Post("clinics/:id/extend")
  @ApiOperation({ summary: "Extend clinic subscription end date by N days" })
  extendSubscription(
    @CurrentUser() actor: User,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(extendClinicSubscriptionSchema))
    dto: ExtendClinicSubscriptionDto
  ) {
    return this.superAdminService.extendClinicSubscription(actor, id, dto);
  }

  @Get("users")
  @ApiOperation({ summary: "List all platform users" })
  listUsers(
    @CurrentUser() actor: User,
    @Query("role") role?: UserRole,
    @Query("search") search?: string
  ) {
    return this.superAdminService.listAllUsers(actor, { role, search });
  }

  @Patch("users/:id")
  @ApiOperation({ summary: "Update user role or active status (Law #3 root owner guard)" })
  updateUser(
    @CurrentUser() actor: User,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateUserRoleOrStatusSchema))
    dto: UpdateUserRoleOrStatusDto
  ) {
    return this.superAdminService.updateUserRoleOrStatus(actor, id, dto);
  }

  @Get("invitations")
  @ApiOperation({ summary: "List all staff and super-admin invitations" })
  listInvitations(
    @Query("status") status?: StaffInvitationStatus,
    @Query("search") search?: string
  ) {
    return this.superAdminService.listAllInvitations({ status, search });
  }

  @Post("invitations")
  @ApiOperation({ summary: "Create a role invitation" })
  createInvitation(
    @CurrentUser() actor: User,
    @Body(new ZodValidationPipe(createRoleInvitationSchema))
    dto: CreateRoleInvitationDto
  ) {
    return this.superAdminService.createRoleInvitation(actor, dto);
  }

  @Delete("invitations/:id")
  @ApiOperation({ summary: "Revoke a pending invitation" })
  revokeInvitation(@CurrentUser() actor: User, @Param("id") id: string) {
    return this.superAdminService.revokeInvitation(actor, id);
  }

  @Get("announcements")
  @ApiOperation({ summary: "List system announcements" })
  listAnnouncements() {
    return this.superAdminService.listAnnouncements();
  }

  @Post("announcements")
  @ApiOperation({ summary: "Create a platform announcement banner" })
  createAnnouncement(
    @CurrentUser() actor: User,
    @Body(new ZodValidationPipe(createAnnouncementSchema)) dto: CreateAnnouncementDto
  ) {
    return this.superAdminService.createAnnouncement(actor, dto);
  }

  @Patch("announcements/:id")
  @ApiOperation({ summary: "Update or toggle a platform announcement" })
  updateAnnouncement(
    @CurrentUser() actor: User,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateAnnouncementSchema)) dto: UpdateAnnouncementDto
  ) {
    return this.superAdminService.updateAnnouncement(actor, id, dto);
  }

  @Delete("announcements/:id")
  @ApiOperation({ summary: "Delete a platform announcement" })
  deleteAnnouncement(@CurrentUser() actor: User, @Param("id") id: string) {
    return this.superAdminService.deleteAnnouncement(actor, id);
  }

  @Get("audit-logs")
  @ApiOperation({ summary: "Query paginated immutable platform audit logs" })
  listAuditLogs(
    @Query("clinicId") clinicId?: string,
    @Query("actorUserId") actorUserId?: string,
    @Query("actionType") actionType?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string
  ) {
    return this.superAdminService.listAuditLogs({
      clinicId,
      actorUserId,
      actionType,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Get("audit-logs/actors")
  @ApiOperation({ summary: "List distinct users who have recorded audit logs" })
  listAuditActors() {
    return this.superAdminService.listAuditActors();
  }

  @Post("clinics/:id/renewal-reminder")
  @ApiOperation({ summary: "Send manual subscription renewal reminder to clinic" })
  sendRenewalReminder(@CurrentUser() actor: User, @Param("id") id: string) {
    return this.superAdminService.sendRenewalReminder(actor, id);
  }

  @Post("invitations/:id/resend")
  @ApiOperation({ summary: "Refresh expiry and resend a pending invitation" })
  resendInvitation(@CurrentUser() actor: User, @Param("id") id: string) {
    return this.superAdminService.resendInvitation(actor, id);
  }

  @Post("plans/ensure-defaults")
  @ApiOperation({ summary: "Idempotently ensure baseline Trial, Starter, and Pro plans exist" })
  ensureDefaultPlans() {
    return this.superAdminService.ensureDefaultPlans();
  }

  @Post("analytics/trigger-rollup")
  @ApiOperation({ summary: "Manually trigger yesterday's daily analytics rollup" })
  triggerDailyRollup(@Query("dateKey") dateKey?: string) {
    return this.superAdminService.triggerDailyRollup(dateKey);
  }
}

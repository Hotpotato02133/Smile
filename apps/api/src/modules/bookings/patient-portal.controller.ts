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
import { CurrentUser } from "../../common/decorators/auth.decorators";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { ClerkJwtGuard } from "../auth/guards/clerk-jwt.guard";
import {
  type CancelMyAppointmentDto,
  cancelMyAppointmentSchema,
  type ClaimWaitlistDto,
  claimWaitlistSchema,
  type CreateOnlineBookingDto,
  createOnlineBookingSchema,
  type CreatePatientProfileDto,
  createPatientProfileSchema,
  type JoinWaitlistDto,
  joinWaitlistSchema,
  type RescheduleMyAppointmentDto,
  rescheduleMyAppointmentSchema,
  type UpdateMedicalProfileDto,
  updateMedicalProfileSchema,
} from "./bookings.schemas";
import { BookingsService } from "./bookings.service";

@ApiTags("Patient Portal & Online Booking")
@ApiBearerAuth("clerk-jwt")
@Controller("patient")
@UseGuards(ClerkJwtGuard)
export class PatientPortalController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Get("dashboard")
  @ApiOperation({ summary: "Get signed-in patient's profiles, appointments, and waitlist" })
  getDashboard(@CurrentUser() user: User) {
    return this.bookingsService.getPatientDashboard(user);
  }

  @Get("clinical-summary")
  @ApiOperation({
    summary: "Get patient's own odontogram tooth records and presigned clinical files",
  })
  getClinicalSummary(
    @CurrentUser() user: User,
    @Query("patientId") patientId?: string
  ) {
    return this.bookingsService.getMyClinicalSummary(user, patientId);
  }

  @Get("waitlist/:id/claim")
  @ApiOperation({ summary: "Fetch waitlist entry details for claiming an open slot" })
  getWaitlistForClaim(@CurrentUser() user: User, @Param("id") id: string) {
    return this.bookingsService.getWaitlistEntryForClaim(user, id);
  }

  @Get("clinics/:clinicId/profiles")
  @ApiOperation({ summary: "List patient's own & dependent profiles for a specific clinic" })
  getClinicProfiles(
    @CurrentUser() user: User,
    @Param("clinicId") clinicId: string
  ) {
    return this.bookingsService.getMyProfilesForClinic(user, clinicId);
  }

  @Post("profiles")
  @ApiOperation({ summary: "Create self or dependent patient profile with medical intake" })
  createProfile(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createPatientProfileSchema))
    dto: CreatePatientProfileDto
  ) {
    return this.bookingsService.createPatientProfile(user, dto);
  }

  @Patch("profiles/:patientId/medical")
  @ApiOperation({ summary: "Update medical history & allergies for an owned patient profile" })
  updateMedical(
    @CurrentUser() user: User,
    @Param("patientId") patientId: string,
    @Body(new ZodValidationPipe(updateMedicalProfileSchema))
    dto: UpdateMedicalProfileDto
  ) {
    return this.bookingsService.updateMedicalProfile(user, patientId, dto);
  }

  @Delete("profiles/:patientId")
  @ApiOperation({ summary: "Delete a dependent patient profile with no active bookings" })
  deleteDependent(
    @CurrentUser() user: User,
    @Param("patientId") patientId: string
  ) {
    return this.bookingsService.deleteDependentProfile(user, patientId);
  }

  @Post("bookings")
  @ApiOperation({ summary: "Submit concurrency-safe online patient booking" })
  createBooking(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createOnlineBookingSchema))
    dto: CreateOnlineBookingDto
  ) {
    return this.bookingsService.createOnlineBooking(user, dto);
  }

  @Post("appointments/:id/cancel")
  @ApiOperation({ summary: "Cancel an appointment within the clinic cancellation window" })
  cancelAppointment(
    @CurrentUser() user: User,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(cancelMyAppointmentSchema))
    dto: CancelMyAppointmentDto
  ) {
    return this.bookingsService.cancelMyAppointment(user, id, dto);
  }

  @Post("appointments/:id/reschedule")
  @ApiOperation({ summary: "Reschedule an appointment within the clinic cancellation window" })
  rescheduleAppointment(
    @CurrentUser() user: User,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(rescheduleMyAppointmentSchema))
    dto: RescheduleMyAppointmentDto
  ) {
    return this.bookingsService.rescheduleMyAppointment(user, id, dto);
  }

  @Post("waitlist")
  @ApiOperation({ summary: "Join clinic waitlist for a preferred date and time window" })
  joinWaitlist(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(joinWaitlistSchema)) dto: JoinWaitlistDto
  ) {
    return this.bookingsService.joinWaitlist(user, dto);
  }

  @Delete("waitlist/:id")
  @ApiOperation({ summary: "Remove an entry from the cancellation waitlist" })
  leaveWaitlist(@CurrentUser() user: User, @Param("id") id: string) {
    return this.bookingsService.leaveWaitlist(user, id);
  }

  @Post("waitlist/:id/claim")
  @ApiOperation({ summary: "Claim an open waitlist slot and book atomically" })
  claimWaitlist(
    @CurrentUser() user: User,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(claimWaitlistSchema)) dto: ClaimWaitlistDto
  ) {
    return this.bookingsService.claimWaitlistSlot(user, id, dto);
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { SchedulingService } from "./scheduling.service";

const acquireSlotLockSchema = z.object({
  serviceId: z.string().uuid(),
  dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTimeUtc: z.number().int().positive(),
  dentistId: z.string().uuid().optional(),
  chairId: z.string().uuid().optional(),
  sessionId: z.string().trim().min(4).max(120),
});

@ApiTags("Scheduling & Slot Locks")
@Controller("public/clinics/:slug")
export class SchedulingController {
  constructor(private readonly schedulingService: SchedulingService) {}

  @Get("slots")
  @ApiOperation({
    summary:
      "Compute real-time dual-resource (dentist + chair + sterilization buffer) available slots",
  })
  getSlots(
    @Param("slug") slug: string,
    @Query("serviceId") serviceId: string,
    @Query("dateKey") dateKey: string,
    @Query("preferredDentistId") preferredDentistId?: string,
    @Query("sessionId") sessionId?: string,
    @Query("ignoreAppointmentId") ignoreAppointmentId?: string,
    @Query("includeEmergencyBuffer") includeEmergencyBuffer?: string
  ) {
    return this.schedulingService.getPublicAvailableSlots({
      slug,
      serviceId,
      dateKey,
      preferredDentistId,
      sessionId,
      ignoreAppointmentId,
      includeEmergencyBuffer: includeEmergencyBuffer === "true",
    });
  }

  @Post("slot-locks")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: "Acquire an atomic 5-minute interval lock via Redis Lua script",
  })
  acquireLock(
    @Param("slug") slug: string,
    @Body(new ZodValidationPipe(acquireSlotLockSchema))
    dto: z.infer<typeof acquireSlotLockSchema>
  ) {
    return this.schedulingService.acquirePublicSlotLock({
      slug,
      ...dto,
    });
  }

  @Delete("slot-locks/:dateKey/:sessionId")
  @ApiOperation({ summary: "Release active slot locks held by the booking session" })
  releaseLock(
    @Param("slug") slug: string,
    @Param("dateKey") dateKey: string,
    @Param("sessionId") sessionId: string
  ) {
    return this.schedulingService.releasePublicSessionLock(
      slug,
      dateKey,
      sessionId
    );
  }
}

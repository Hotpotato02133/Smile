import { Controller, Get, Param } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { BookingsService } from "./bookings.service";

@ApiTags("Public Clinic Directory & Portal")
@Controller("public/clinics")
export class PublicBookingController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Get()
  @ApiOperation({ summary: "List sanitized public clinics accepting bookings (zero PHI)" })
  listClinics() {
    return this.bookingsService.listPublicClinics();
  }

  @Get(":slug")
  @ApiOperation({ summary: "Get public clinic portal metadata, services, and dentists" })
  getClinicBySlug(@Param("slug") slug: string) {
    return this.bookingsService.getPublicClinicBySlug(slug);
  }
}

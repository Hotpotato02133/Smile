import { Module } from "@nestjs/common";
import { AppointmentsModule } from "../appointments/appointments.module";
import { SchedulingModule } from "../scheduling/scheduling.module";
import { BookingsService } from "./bookings.service";
import { PatientPortalController } from "./patient-portal.controller";
import { PublicBookingController } from "./public-booking.controller";

@Module({
  imports: [AppointmentsModule, SchedulingModule],
  controllers: [PublicBookingController, PatientPortalController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}

import { Global, Module } from "@nestjs/common";
import { EmailTransportService } from "./email-transport.service";
import { NotificationsService } from "./notifications.service";

@Global()
@Module({
  providers: [EmailTransportService, NotificationsService],
  exports: [EmailTransportService, NotificationsService],
})
export class NotificationsModule {}

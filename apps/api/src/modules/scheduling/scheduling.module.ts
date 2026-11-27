import { Module } from "@nestjs/common";
import { SchedulingController } from "./scheduling.controller";
import { SchedulingService } from "./scheduling.service";
import { SlotLockService } from "./slot-lock.service";

@Module({
  controllers: [SchedulingController],
  providers: [SlotLockService, SchedulingService],
  exports: [SlotLockService, SchedulingService],
})
export class SchedulingModule {}

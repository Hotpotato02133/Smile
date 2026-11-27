import { Module } from "@nestjs/common";
import { CronSecretGuard } from "./cron-secret.guard";
import { JobsController } from "./jobs.controller";
import { JobsService } from "./jobs.service";

@Module({
  controllers: [JobsController],
  providers: [CronSecretGuard, JobsService],
  exports: [JobsService],
})
export class JobsModule {}

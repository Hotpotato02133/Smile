import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiHeader, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CronSecretGuard } from "./cron-secret.guard";
import { JobsService } from "./jobs.service";

@ApiTags("Internal Scheduled Jobs (GitHub Actions Cron)")
@ApiHeader({
  name: "X-Cron-Secret",
  description: "Shared secret matching CRON_SECRET env var",
  required: true,
})
@Controller("internal/cron")
@UseGuards(CronSecretGuard)
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post("sweep-subscriptions")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Daily 00:05 UTC: transition expired subscriptions, suspend expired grace periods, reset monthly counters",
  })
  sweepSubscriptions() {
    return this.jobsService.sweepSubscriptions();
  }

  @Post("rollup-daily-analytics")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Daily 16:15 UTC: roll up yesterday's clinic & platform analytics",
  })
  rollupDailyAnalytics(@Query("dateKey") dateKey?: string) {
    return this.jobsService.rollupDailyAnalytics(dateKey);
  }

  @Post("reminders-24h")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Daily 01:00 UTC: dispatch 24-hour appointment reminder emails",
  })
  dispatch24hReminders() {
    return this.jobsService.dispatch24hReminders();
  }

  @Post("hygiene-recalls")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Daily 01:30 UTC: dispatch 6-month hygiene recall emails",
  })
  dispatchHygieneRecalls() {
    return this.jobsService.dispatchHygieneRecalls();
  }
}

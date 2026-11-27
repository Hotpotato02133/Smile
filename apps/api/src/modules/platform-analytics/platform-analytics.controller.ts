import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Roles } from "../../common/decorators/auth.decorators";
import { ClerkJwtGuard } from "../auth/guards/clerk-jwt.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { PlatformAnalyticsService } from "./platform-analytics.service";

@ApiTags("Platform Analytics")
@ApiBearerAuth("clerk-jwt")
@Controller("super-admin/analytics")
@UseGuards(ClerkJwtGuard, RolesGuard)
@Roles("super_admin")
export class PlatformAnalyticsController {
  constructor(private readonly analyticsService: PlatformAnalyticsService) {}

  @Get("overview")
  @ApiOperation({ summary: "Get cross-clinic MRR, ARR, conversion, and renewal queue" })
  getOverview() {
    return this.analyticsService.getDashboardOverview();
  }

  @Get("daily-metrics")
  @ApiOperation({ summary: "Get daily platform metrics series for Recharts" })
  getDailyMetrics(@Query("days") days?: string) {
    return this.analyticsService.getDailyMetricsSeries(days ? Number(days) : 30);
  }

  @Get("leaderboard")
  @ApiOperation({ summary: "Get top clinics by monthly and lifetime appointment volume" })
  getLeaderboard(@Query("limit") limit?: string) {
    return this.analyticsService.getClinicLeaderboard(limit ? Number(limit) : 10);
  }

  @Get("free-tier-usage")
  @ApiOperation({ summary: "Monitor R2 storage, email, and Clerk MAU free-tier ceilings" })
  getFreeTierUsage() {
    return this.analyticsService.getFreeTierUsage();
  }
}

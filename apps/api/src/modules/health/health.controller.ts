import { Controller, Get, HttpStatus, Res } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { HealthCheckService, HealthIndicatorService } from "@nestjs/terminus";
import type { Response } from "express";
import {
  type DependencyStatus,
  PostgresHealthService,
} from "../../infra/postgres-health.service";
import { RedisService } from "../../infra/redis.service";

export interface HealthResponseDto {
  status: "ok" | "degraded";
  db: DependencyStatus;
  redis: DependencyStatus;
  service: string;
  timestamp: string;
  uptimeSeconds: number;
}

@ApiTags("Health")
@Controller("health")
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicator: HealthIndicatorService,
    private readonly postgres: PostgresHealthService,
    private readonly redis: RedisService
  ) {}

  @Get("live")
  @ApiOperation({ summary: "Liveness probe (process is up and serving HTTP)" })
  @ApiResponse({ status: 200, description: "API process is alive." })
  liveness() {
    return {
      status: "ok",
      service: "smile-api",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    };
  }

  @Get()
  @ApiOperation({
    summary: "Readiness probe checking PostgreSQL and Redis connectivity",
  })
  @ApiResponse({
    status: 200,
    description: "Database and Redis dependencies are healthy.",
  })
  @ApiResponse({
    status: 503,
    description: "One or more backing dependencies are unavailable.",
  })
  async readiness(@Res() res: Response): Promise<void> {
    let dbStatus: DependencyStatus = "down";
    let redisStatus: DependencyStatus = "down";

    try {
      await this.health.check([
        async () => {
          const check = this.indicator.check("db");
          const result = await this.postgres.check();
          dbStatus = result.status;
          if (result.status === "up") {
            return check.up();
          }
          return check.down({
            state: result.status,
            ...(result.error ? { message: result.error } : {}),
          });
        },
        async () => {
          const check = this.indicator.check("redis");
          const result = await this.redis.check();
          redisStatus = result.status;
          if (result.status === "up") {
            return check.up();
          }
          return check.down({
            state: result.status,
            ...(result.error ? { message: result.error } : {}),
          });
        },
      ]);

      const payload: HealthResponseDto = {
        status: "ok",
        db: dbStatus,
        redis: redisStatus,
        service: "smile-api",
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.round(process.uptime()),
      };
      res.status(HttpStatus.OK).json(payload);
    } catch {
      const payload: HealthResponseDto = {
        status: "degraded",
        db: dbStatus,
        redis: redisStatus,
        service: "smile-api",
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.round(process.uptime()),
      };
      res.status(HttpStatus.SERVICE_UNAVAILABLE).json(payload);
    }
  }
}

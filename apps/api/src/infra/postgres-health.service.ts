import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Pool } from "pg";
import type { AppEnv } from "../config/env";

export type DependencyStatus = "up" | "down" | "unconfigured";

@Injectable()
export class PostgresHealthService implements OnModuleDestroy {
  private readonly pool: Pool | null;

  constructor(configService: ConfigService<AppEnv, true>) {
    const databaseUrl = configService.get("DATABASE_URL", { infer: true })?.trim();
    if (!databaseUrl) {
      this.pool = null;
      return;
    }
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 2,
      connectionTimeoutMillis: 2000,
      idleTimeoutMillis: 10000,
    });
  }

  async check(): Promise<{ status: DependencyStatus; error?: string }> {
    if (!this.pool) {
      return { status: "unconfigured" };
    }
    try {
      await this.pool.query("SELECT 1");
      return { status: "up" };
    } catch (error) {
      return {
        status: "down",
        error: error instanceof Error ? error.message : "PostgreSQL probe failed",
      };
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pool) {
      await this.pool.end().catch(() => undefined);
    }
  }
}

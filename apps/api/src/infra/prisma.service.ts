import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import type { AppEnv } from "../config/env";
import type { DependencyStatus } from "./postgres-health.service";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  private readonly pool: Pool | null;
  public readonly isConfigured: boolean;

  constructor(configService: ConfigService<AppEnv, true>) {
    const databaseUrl = configService.get("DATABASE_URL", { infer: true })?.trim();
    const pool = databaseUrl
      ? new Pool({
          connectionString: databaseUrl,
          max: 10,
          connectionTimeoutMillis: 10000,
          idleTimeoutMillis: 30000,
        })
      : new Pool({
          connectionString: "postgresql://unconfigured:unconfigured@127.0.0.1:1/unconfigured",
          max: 1,
          connectionTimeoutMillis: 500,
        });

    const adapter = new PrismaPg(pool);
    super({ adapter });

    this.pool = pool;
    this.isConfigured = Boolean(databaseUrl);
  }

  async checkHealth(): Promise<{ status: DependencyStatus; error?: string }> {
    if (!this.isConfigured) {
      return { status: "unconfigured" };
    }
    try {
      await this.$queryRaw`SELECT 1`;
      return { status: "up" };
    } catch (error) {
      return {
        status: "down",
        error: error instanceof Error ? error.message : "PostgreSQL probe failed",
      };
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect().catch(() => undefined);
    if (this.pool) {
      await this.pool.end().catch(() => undefined);
    }
  }
}

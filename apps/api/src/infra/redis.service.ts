import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";
import type { AppEnv } from "../config/env";
import type { DependencyStatus } from "./postgres-health.service";

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis | null;

  constructor(configService: ConfigService<AppEnv, true>) {
    const redisUrl = configService.get("REDIS_URL", { infer: true })?.trim();
    if (!redisUrl) {
      this.client = null;
      return;
    }

    this.client = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      connectTimeout: 5000,
      enableReadyCheck: false,
      retryStrategy: (times) => (times <= 5 ? Math.min(times * 250, 2000) : null),
    });

    // Prevent unhandled 'error' event crashes during idle/offline Upstash disconnects
    this.client.on("error", (err) => {
      this.logger.warn(`Redis connection warning: ${err.message}`);
    });
  }

  getClient(): Redis | null {
    return this.client;
  }

  async check(): Promise<{ status: DependencyStatus; error?: string }> {
    if (!this.client) {
      return { status: "unconfigured" };
    }
    try {
      if (this.client.status === "wait" || this.client.status === "end") {
        await this.client.connect();
      }
      const pong = await this.client.ping();
      return pong === "PONG"
        ? { status: "up" }
        : { status: "down", error: `Unexpected PING reply: ${pong}` };
    } catch (error) {
      return {
        status: "down",
        error: error instanceof Error ? error.message : "Redis probe failed",
      };
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
      } catch {
        this.client.disconnect();
      }
    }
  }
}

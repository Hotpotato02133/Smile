import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";
import type { AppEnv } from "../config/env";
import type { DependencyStatus } from "./postgres-health.service";

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis | null;

  constructor(configService: ConfigService<AppEnv, true>) {
    const redisUrl = configService.get("REDIS_URL", { infer: true })?.trim();
    if (!redisUrl) {
      this.client = null;
      return;
    }

    this.client = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      enableReadyCheck: false,
      retryStrategy: () => null,
    });

    // Prevent unhandled 'error' event crashes during offline health probes
    this.client.on("error", () => undefined);
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

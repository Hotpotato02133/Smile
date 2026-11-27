import { Global, Module } from "@nestjs/common";
import { PostgresHealthService } from "./postgres-health.service";
import { PrismaService } from "./prisma.service";
import { RedisService } from "./redis.service";

@Global()
@Module({
  providers: [PrismaService, PostgresHealthService, RedisService],
  exports: [PrismaService, PostgresHealthService, RedisService],
})
export class InfraModule {}

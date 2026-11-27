import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { LoggerModule } from "nestjs-pino";
import { type AppEnv, validateEnv } from "./config/env";
import { InfraModule } from "./infra/infra.module";
import { AuditModule } from "./modules/audit/audit.module";
import { AuthModule } from "./modules/auth/auth.module";
import { HealthModule } from "./modules/health/health.module";
import { UsersModule } from "./modules/users/users.module";
import { WebhooksModule } from "./modules/webhooks/webhooks.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      envFilePath: [".env.local", ".env"],
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppEnv, true>) => {
        const nodeEnv = config.get("NODE_ENV", { infer: true });
        return {
          pinoHttp: {
            level:
              nodeEnv === "test"
                ? "silent"
                : nodeEnv === "production"
                  ? "info"
                  : "debug",
            transport:
              nodeEnv === "development"
                ? {
                    target: "pino-pretty",
                    options: {
                      colorize: true,
                      singleLine: true,
                    },
                  }
                : undefined,
            redact: ["req.headers.authorization", "req.headers.cookie"],
          },
        };
      },
    }),
    InfraModule,
    AuditModule,
    AuthModule,
    HealthModule,
    UsersModule,
    WebhooksModule,
  ],
})
export class AppModule {}

import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { LoggerModule } from "nestjs-pino";
import { type AppEnv, validateEnv } from "./config/env";
import { InfraModule } from "./infra/infra.module";
import { AppointmentsModule } from "./modules/appointments/appointments.module";
import { AuditModule } from "./modules/audit/audit.module";
import { AuthModule } from "./modules/auth/auth.module";
import { BillingModule } from "./modules/billing/billing.module";
import { BookingsModule } from "./modules/bookings/bookings.module";
import { ClinicsModule } from "./modules/clinics/clinics.module";
import { HealthModule } from "./modules/health/health.module";
import { InvitationsModule } from "./modules/invitations/invitations.module";
import { PlatformAnalyticsModule } from "./modules/platform-analytics/platform-analytics.module";
import { RealtimeModule } from "./modules/realtime/realtime.module";
import { SchedulingModule } from "./modules/scheduling/scheduling.module";
import { SuperAdminModule } from "./modules/super-admin/super-admin.module";
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
    RealtimeModule,
    HealthModule,
    UsersModule,
    WebhooksModule,
    SuperAdminModule,
    BillingModule,
    PlatformAnalyticsModule,
    ClinicsModule,
    InvitationsModule,
    SchedulingModule,
    AppointmentsModule,
    BookingsModule,
  ],
})
export class AppModule {}

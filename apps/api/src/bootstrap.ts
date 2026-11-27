import { INestApplication, RequestMethod } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { Logger } from "nestjs-pino";
import { ApiExceptionFilter } from "./common/filters/api-exception.filter";
import type { AppEnv } from "./config/env";

export function configureApp(app: INestApplication): void {
  const configService = app.get(ConfigService<AppEnv, true>);
  const corsOrigin = configService.get("CORS_ORIGIN", { infer: true });

  app.useLogger(app.get(Logger));
  app.use(helmet());
  app.enableCors({
    origin: corsOrigin
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    credentials: true,
  });

  app.setGlobalPrefix("api/v1", {
    exclude: [
      { path: "health", method: RequestMethod.GET },
      { path: "health/live", method: RequestMethod.GET },
    ],
  });

  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle("Smile Dental SaaS API")
    .setDescription(
      "Multi-tenant dental practice management & dual-resource scheduling API (NestJS + PostgreSQL + Redis + Socket.IO + Cloudflare R2)."
    )
    .setVersion("1.0.0")
    .addBearerAuth(
      {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Clerk session JWT",
      },
      "clerk-jwt"
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("api/docs", app, document, {
    jsonDocumentUrl: "api/docs-json",
  });
}

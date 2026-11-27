import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  APP_BASE_URL: z.string().default("http://localhost:3000"),

  // PostgreSQL 16 (Docker local or Neon Free)
  DATABASE_URL: z.string().optional(),
  DIRECT_URL: z.string().optional(),

  // Redis 7 (Docker local or Upstash Free)
  REDIS_URL: z.string().optional(),
  // Set true in local Docker / always-on VM; leave false on Render Free + Upstash Free to avoid polling commands
  ENABLE_BULLMQ_WORKER: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  // Clerk Auth & RBAC
  CLERK_SECRET_KEY: z.string().optional(),
  CLERK_WEBHOOK_SECRET: z.string().optional(),
  SUPER_ADMIN_EMAIL: z.string().optional(),

  // Internal Cron Security (GitHub Actions -> POST /api/v1/internal/cron/*)
  CRON_SECRET: z.string().optional(),

  // Cloudflare R2 Object Storage
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_PRIVATE_BUCKET: z.string().default("smile-private"),
  R2_PUBLIC_BUCKET: z.string().default("smile-public"),
  R2_PUBLIC_BASE_URL: z.string().optional(),

  // Dual Email Transport (Resend OR Gmail SMTP)
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().default("Smile Dental <onboarding@resend.dev>"),
  GMAIL_USER: z.string().optional(),
  GMAIL_APP_PASSWORD: z.string().optional(),
  GMAIL_FROM_NAME: z.string().default("Smile Dental"),
});

export type AppEnv = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): AppEnv {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return parsed.data;
}

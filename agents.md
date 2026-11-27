# AGENTS.md — Master AI Agent Constitution & Orchestration Rules

## 1. Project Identity & Mission Statement

**Project Name**: **Smile Dental Scheduling System**
**Architecture Class**: Multi-Tenant Dental Practice Management & Appointment Scheduling SaaS
**Target Budget**: Strictly **$0.00 / month** across frontend, dedicated backend API, PostgreSQL, Redis, object storage, auth, email, and scheduled jobs.

You are an autonomous AI software engineering agent working on the **Smile Dental Scheduling System** monorepo (`apps/web`, `apps/api`, `packages/shared`). Every line of code, SQL migration, NestJS controller, guard, worker, and UI component you generate must adhere to the multi-tenant isolation rules and $0/month free-tier budgets below.

## 2. Monorepo Layout & Core Technology Stack

| Workspace / Layer | Approved Technology | Free-Tier Ceiling | Mandatory Engineering Rule |
| :--- | :--- | :--- | :--- |
| **`apps/web`** | Next.js 16 (App Router) + TypeScript + Tailwind v4 + shadcn/ui + TanStack Query + Socket.IO Client | Vercel Hobby ($0) | Strict TypeScript (`strict: true`). Consume `apps/api` through `@/lib/api` (`api-client.ts`, TanStack Query hooks, `SocketProvider`). |
| **`apps/api`** | NestJS 11 + Swagger OpenAPI (`/api/docs`) + Pino + Terminus (`/health`) | Render Free Web Service (750 hrs/mo, 512 MB RAM) or Oracle Cloud Always Free VM | Enforce `NODE_OPTIONS="--max-old-space-size=384"` in containers. Validate all request bodies with Zod v4 pipes (`ZodValidationPipe`). |
| **`packages/shared`** | Shared TypeScript + Zod v4 enums, error codes, pure timezone/interval math, default service catalog | Open-source ($0) | Single source of truth for validation & scheduling math across `apps/web` and `apps/api`. |
| **Relational Database** | PostgreSQL 16 (Neon Free / Docker Compose) + Prisma ORM (`@prisma/adapter-pg`) | Neon Free (0.5–1 GB storage, 100 CU-hrs/mo) | Use `TIMESTAMPTZ` for timestamps, `BIGINT` for byte counters, compound indexes on `clinic_id`, and `EXCLUDE USING GIST` on `appointments`. |
| **Locks & Cache** | Redis 7 (`ioredis` / Upstash Redis Free) | Upstash Free (250 MB, 500K commands/mo) | Use atomic Redis Lua interval locks (`slot_locks:{clinicId}:{dateKey}`). Keep `ENABLE_BULLMQ_WORKER=false` on Upstash Free to avoid idle polling. |
| **Object Storage** | Cloudflare R2 (S3 Presigned URLs) | 10 GB/mo storage, $0 egress | Separate `public/logos/*` from `private/clinical/*` and `private/receipts/*`. Verify uploaded size <= 500 KB via R2 `HeadObject` before committing quota. |
| **Auth & RBAC** | Clerk (`@clerk/nextjs` + `@clerk/backend`) | 10,000 MAU | Verify Clerk session JWTs in `ClerkJwtGuard`, resolve role & `clinicId` from PostgreSQL `users`, and mirror `{ role, clinicId }` back to Clerk `publicMetadata` for `apps/web/src/proxy.ts`. |
| **Async Jobs & Crons** | BullMQ (local Docker / always-on VM) + GitHub Actions Daily Crons | Included ($0) | Protect `POST /api/v1/internal/cron/*` with constant-time `CronSecretGuard` (`X-Cron-Secret`). |
| **Transactional Email** | Resend OR Gmail SMTP (`nodemailer`) | 3,000 emails/mo (Resend) / free Gmail App Password | Enforce per-clinic and global 3,000/mo email quotas in `NotificationsService.reserveEmailQuota`. |

## 3. Non-Negotiable Multi-Tenant & Security Laws

1. **Enforce Mandatory `clinic_id` Isolation**: Every operational table (`dentists`, `dentist_time_off`, `chairs`, `services`, `appointments`, `patients`, `tooth_records`, `clinical_files`, `waitlist`, `clinic_metrics_daily`) must scope queries and mutations by `clinicId` derived strictly from the verified PostgreSQL `users` row (`TenantAccessGuard`).
2. **Verify Identity Inside Every Protected Endpoint**: Never trust client-supplied `userId`, `role`, or `clinicId` arguments. Always enforce `ClerkJwtGuard`, `RolesGuard`, and `TenantAccessGuard`.
3. **Restrict Root Super Admin Privilege**: Only a user whose `users.role === "super_admin"` AND whose email matches `process.env.SUPER_ADMIN_EMAIL` may grant/revoke Super Admin privileges (`@RequireRootSuperAdmin()`).
4. **Enforce Subscription Status & Quota Gates**: Use `ClinicQuotaGuard` (`@RequireClinicWrite(...)` + `@RequireClinicFeature(...)`) to enforce `active`/`trial`, `past_due` (3-day grace window), `suspended`/`archived` (strictly Read-Only Mode), and plan resource limits (`QUOTA_EXCEEDED`).
5. **Prevent Double-Booking via Two-Layer ACID Protection**: Wrap every appointment creation/reschedule in `prisma.$transaction` acquiring canonical `SELECT ... FOR UPDATE` locks (`dentists` first, then `chairs`) backed by PostgreSQL `EXCLUDE USING GIST` partial constraints (`23P01` -> `409 SLOT_UNAVAILABLE`).
6. **Protect Sensitive Clinical Data (Zero PHI on Public Routes)**: Public endpoints (`/api/v1/public/*`) and public Socket.IO rooms (`public:clinic:<slug>`) must never expose patient intake, allergies, odontogram notes, or private X-ray URLs. Serve clinical X-rays exclusively via short-lived presigned GET URLs.
7. **Log Every Sensitive Mutation**: Record immutable entries in `platform_audit_logs` via `AuditService.record(..., tx)` inside the same database transaction.

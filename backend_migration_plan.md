# BACKEND_MIGRATION_PLAN.md — Dedicated Backend Server Architecture & Migration Plan (v2)

> **Branch Strategy:** All migration work lives on the `staging` branch. `master` remains untouched as the working Next.js 16 + Convex baseline reference until Phase 6 cutover is 100% verified.
> **Primary Goal:** Showcase senior-level **Backend Engineering** skills as a Fullstack Developer while staying strictly **$0.00 / month** across database, cache, queues, object storage, auth, email, and hosting.

---

## 1. Current Codebase Audit (`Smile` Repository)

Verified against the current repository (`smile-dental-scheduling-system`):

| Codebase Dimension | Current State in Repo | Migration Impact |
| :--- | :--- | :--- |
| **Database Schema** | **19 Convex tables** in `convex/schema.ts` | Translates cleanly into normalized PostgreSQL 16 tables in `prisma/schema.prisma` using `TIMESTAMPTZ`, typed `JSONB` (for schedules/flags/intake), composite B-Tree indexes, and `EXCLUDE USING GIST` overlap constraints. |
| **Backend Logic** | **21+ backend modules** (~360 KB) across `convex/*.ts` | Maps 1-to-1 into modular NestJS controllers, services, guards, interceptors, and async workers. |
| **Reusable Logic** | `convex/lib/scheduling.ts` (22.6 KB — top ~120 lines pure math + DB-backed slot queries), `convex/emails/templates.ts` (20.3 KB), `convex/lib/serviceCatalog.ts` | Pure date/timezone/interval math and Zod DTOs move into `packages/shared`; DB-backed slot engine moves into `apps/api/src/modules/scheduling`. |
| **Storage Flows** | **3 distinct storage flows** (`files.ts` X-rays, `clinicAdmin.ts` logos, `subscriptions.ts` payment receipts) | Migrates to **Cloudflare R2** with strict bucket/key separation: public clinic logos vs. private presigned GET/PUT URLs for X-rays & receipts + server-side `HeadObject` size verification (<= 500 KB). |
| **Email Transport** | Dual transport: **Resend** + **Gmail SMTP** (`nodemailer` in `convex/emailSender.ts`) | Both transports preserved in `NotificationsModule` so $0 email works even without a custom domain. |
| **Frontend Integration** | **196 Convex hook calls** (`useQuery`, `useMutation`, `useAction`, `useConvexAuth`) across **26 Next.js 16 pages** | Replaced progressively via typed `src/lib/api-client.ts` + TanStack Query + Socket.IO query invalidation without rewriting shadcn/ui components. |
| **Edge Auth & Sync** | `src/proxy.ts` (`@clerk/nextjs@7.9.26` + `next@16.4.6`), `syncClerkMetadata`, and `ensureUser` fallback | `src/proxy.ts` stays intact; NestJS verifies default Clerk session JWTs via `@clerk/backend` (`verifyToken`), mirrors role/clinicId back to Clerk `public_metadata`, and exposes `POST /users/ensure` for local dev / webhook lag. |

---

## 2. Finalized Backend Stack ($0/Month & Interview-Ready)

| Backend Pillar | Chosen Technology | Why It Fits Smile & Proves Backend Mastery |
| :--- | :--- | :--- |
| **API Framework** | **NestJS** (TypeScript, strict mode) | Modular architecture, Dependency Injection, custom `@Roles()` / `@Tenant()` / `@Quota()` Guards, `@AuditLog()` Interceptor, global Exception Filters, and Swagger OpenAPI (`/api/docs`). |
| **Relational DB & ORM** | **PostgreSQL 16** ([Neon Free](https://neon.com/docs/introduction/plans)) + **Prisma ORM** (100% free open-source, using `@prisma/adapter-pg` for low-memory footprint) | Relational schema design, Prisma migrations, SQL aggregations (`GROUP BY` for MRR/analytics), deterministic `SELECT ... FOR UPDATE`, and Postgres `EXCLUDE USING GIST` constraints. |
| **Distributed Locks & Cache** | **Redis 7** (`ioredis` locally / [Upstash Redis Free](https://upstash.com/pricing/redis) in prod) | Atomic **Redis Lua script** for interval-aware 5-minute slot locking (`[startUtc, bufferEndUtc)`), sliding-window rate limiting on `/public/clinics/:slug/*`, and clinic portal caching. |
| **Async Jobs & Crons** | **BullMQ** (local Docker / always-on VM) + **GitHub Actions Cron** (prod free-tier wakeup) | Durable async email & waitlist blast workers with exponential backoff retries; GitHub Actions `schedule` triggers secured `POST /internal/cron/:job` endpoints so daily crons never miss due to Render Free sleep. |
| **Real-Time WebSockets** | **Socket.IO** (`@nestjs/websockets`) | JWT-authenticated tenant rooms (`clinic:<clinicId>`) for `/front-desk`, `/staff`, `/admin` and sanitized public rooms (`public:clinic:<slug>`) for live slot availability on `/c/[slug]`. |
| **Object Storage** | **Cloudflare R2** (S3-compatible [Presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)) | 10 GB free storage & $0 egress; direct-to-bucket presigned PUT uploads, server-side `HeadObject` 500 KB verification, atomic `storage_used_bytes` accounting, and short-lived presigned GET URLs for PHI X-rays. |
| **Containerization & CI** | **Docker Compose** + **Jest** + **Supertest** + **GitHub Actions** | Reproducible local infra (`Postgres 16 + Redis 7 + API`), automated race-condition concurrency tests, and CI verification on every push. *(Note: Local dev also supports pointing directly to Neon dev branch + Upstash Redis if Docker Desktop isn't running.)* |

---

## 3. Recommended Repo Strategy (`staging` Branch Monorepo)

Use **npm workspaces** (natively supported by your installed `npm 11.17.0` — zero package-manager migration friction) + **Turborepo** on the `staging` branch:

- **Why convert to the final monorepo layout upfront on `staging`?**
  1. `master` stays 100% intact and deployable on Convex while you build.
  2. Moving Next.js into `apps/web` in Phase 1 means `tsconfig`, Tailwind v4, shadcn `components.json`, ESLint, and `packages/shared` workspace imports are configured **once** and never break mid-migration.
  3. `apps/web/convex/` remains readable as a reference during Phases 2–5 and is cleanly removed only in Phase 6 after full frontend verification.

| Workspace Path | Contents | Role |
| :--- | :--- | :--- |
| `apps/web` | Existing Next.js 16 app (`src/app`, `src/components`, `src/proxy.ts`, `public/`) | Frontend UI consuming `apps/api` via REST + TanStack Query + Socket.IO. |
| `apps/api` | New standalone **NestJS** backend server (`src/modules/*`, `prisma/`, `test/`) | Owns PostgreSQL (Prisma), Redis, BullMQ/Jobs, Socket.IO gateway, R2 storage, Swagger (`/api/docs`), and Clerk webhooks. |
| `packages/shared` | Pure TypeScript + Zod v4 schemas, `UserRole` enums, date/timezone/interval math from `scheduling.ts`, and API DTO types | Single source of truth for validation and types across `apps/web` and `apps/api`. |
| `docker-compose.yml` | PostgreSQL 16, Redis 7, and NestJS API containers | One-command local environment (`docker compose up -d`) for recruiters and developers. |

---

## 4. Exact Mapping: 21 `convex/` Files → NestJS Backend Modules

| Existing Convex Files | New NestJS Module (`apps/api/src/modules/`) | Core REST Endpoints & Backend Patterns |
| :--- | :--- | :--- |
| `auth.config.ts`, `users.ts`, `http.ts`, `lib/permissions.ts` | `auth/`, `users/`, `common/guards/` | `ClerkJwtGuard` (`@clerk/backend` `verifyToken`), `RolesGuard`, `TenantAccessGuard`, `ClerkService.syncPublicMetadata()`, `POST /webhooks/clerk` (Svix verification), `GET /users/me`, `POST /users/ensure`. |
| `superAdmin.ts`, `subscriptions.ts`, `platformAnalytics.ts` | `super-admin/`, `billing/` | `POST /super-admin/clinics`, `PATCH /super-admin/clinics/:id/status`, `POST /super-admin/payments` (with R2 receipt presign), `GET /super-admin/analytics/mrr` (SQL aggregations), `GET /super-admin/audit-logs`. |
| `clinicAdmin.ts`, `invitations.ts`, `lib/serviceCatalog.ts` | `clinics/`, `resources/`, `invitations/` | CRUD for `/clinics/:clinicId/dentists`, `/chairs`, `/services`, `/invitations`, `/settings`, clinic logo upload (R2 public prefix), and `QuotaGuard` + `ClinicWriteGuard` enforcing Law #4 & plan quotas. |
| `availability.ts`, `slotLocks.ts`, `lib/scheduling.ts` | `scheduling/` | `GET /public/clinics/:slug/slots`, `POST /public/clinics/:slug/slot-locks` (atomic Redis Lua interval lock), `DELETE /public/clinics/:slug/slot-locks/session/:sessionId`. |
| `appointments.ts`, `publicBooking.ts`, `patientPortal.ts`, `waitlist.ts` | `appointments/`, `patients/`, `waitlist/` | `POST /appointments` & `POST /public/clinics/:slug/bookings` (Postgres `FOR UPDATE` + `EXCLUDE USING GIST`), `PATCH /appointments/:id/status` (emits Socket.IO event), `POST /waitlist`. |
| `odontogram.ts`, `files.ts` | `clinical/`, `storage/` | `GET/PUT /patients/:id/odontogram`, `POST /storage/presign-upload`, `POST /clinical/files/confirm` (R2 `HeadObject` <= 500 KB verification + atomic `storage_used_bytes` update), `GET /clinical/files` (short-lived presigned GET URLs). |
| `crons.ts`, `cronJobs.ts`, `notifications.ts`, `emailSender.ts`, `emails/templates.ts` | `jobs/`, `notifications/` | `POST /internal/cron/:jobName` (protected by `X-Cron-Secret`, triggered by GitHub Actions daily), BullMQ email/waitlist workers (with Resend + Gmail SMTP `nodemailer` dual transport). |

---

## 5. Six High-Impact Backend Engineering Features to Showcase

1. **Double-Booking Immunity (Two-Layer ACID Protection):**
   * **Layer 1 (Application Transaction):** Inside `AppointmentsService.create()` / `reschedule()`, acquire deterministic row locks (`SELECT ... FOR UPDATE` always locking `dentists` first, then `chairs`) to prevent deadlocks and race conditions.
   * **Layer 2 (Database Engine Invariant):** Enforce PostgreSQL **`EXCLUDE USING GIST`** partial constraints (`WHERE status NOT IN ('cancelled', 'no_show')`) over `(dentist_id WITH =, tstzrange(start_time_utc, buffer_end_time_utc, '[)') WITH &&)` and `(chair_id WITH =, tstzrange(start_time_utc, buffer_end_time_utc, '[)') WITH &&)`. Catch Postgres `23P01` and translate cleanly to HTTP `409 Conflict`.
   * **Proof:** Jest + Supertest concurrency test (`Promise.all` of 5 simultaneous booking requests) proving **1 `201 Created`** and **4 `409 Conflict`**.

2. **Interval-Aware Atomic Redis Slot Locking (Lua Script):**
   * Instead of naive `startUtc` keys (which fail when services have different durations/buffers), store active locks per clinic/date in a Redis Hash `slot_locks:{clinicId}:{dateKey}` and execute a single **atomic Lua script** that:
     1. Purges expired lock entries.
     2. Releases any prior lock held by the same `sessionId`.
     3. Checks `[startUtc, bufferEndUtc)` overlap against all active locks for both `dentistId` and `chairId`.
     4. Writes the new lock (`expiresAt = now + 300s`) and refreshes hash TTL.
   * `GET /public/clinics/:slug/slots` reads the single hash in O(active locks for that day) with zero `SCAN` calls.

3. **Real-Time Socket.IO Architecture with Tenant Security:**
   * Authenticate WebSocket handshakes with Clerk JWTs via `SocketAuthMiddleware` (verifying `users.clinicId` from DB before joining `clinic:<clinicId>` — impossible to snoop another tenant).
   * Separate unauthenticated `public:clinic:<slug>` room emitting **only** `{ dateKey }` slot invalidations (zero PHI/patient data).
   * Maintain an explicit **Event → TanStack Query Invalidation Map** (`appointment.changed`, `slot_lock.changed`, `clinic.status_changed`, `announcement.changed`, `odontogram.updated`, `waitlist.updated`).

4. **Multi-Tenant Security, Subscription Gates & Audit Interceptor:**
   * Global `TenantAccessGuard` derives `clinicId` strictly from verified Clerk JWT + PostgreSQL `users` row (never trusting body `clinicId`, except `super_admin` strictly read-only `?overrideClinicId` View-As-Clinic mode).
   * Reusable `ClinicWriteGuard` + `QuotaGuard` enforce subscription status (`trial`, `active`, `past_due` 3-day grace window, `suspended`/`archived` read-only) and plan limits (`maxDentists`, `maxChairs`, `maxAppointmentsPerMonth`, `maxStorageBytes`, `maxEmailsPerMonth`).
   * Declarative `@AuditLog("CLINIC_SUSPENDED")` decorator + NestJS Interceptor writes actor, role, clinic, target entity, IP, and metadata diff to `platform_audit_logs`.

5. **Zero-Trust Presigned R2 Storage with Server-Side Verification:**
   * Three explicit R2 key prefixes: `public/logos/{clinicId}/...`, `private/clinical/{clinicId}/{patientId}/...`, and `private/receipts/{clinicId}/...`.
   * Client uploads directly to R2 via short-lived presigned `PUT` URL; on confirmation, `StorageService` runs S3 `HeadObject` to verify actual byte size `<= 500 KB` (deleting the object immediately if oversized or over quota) before committing `clinical_files` and incrementing `clinics.storage_used_bytes` inside a Prisma transaction.

6. **Production Observability, OpenAPI & Automated CI:**
   * Interactive Swagger UI at `/api/docs`, `@nestjs/terminus` health check at `GET /health` (Postgres + Redis status), structured JSON logging (`nestjs-pino`), and GitHub Actions CI running `tsc --noEmit`, `eslint`, `prisma migrate deploy`, and Jest + Supertest integration tests.

---

## 6. Six-Phase Migration Roadmap (Zero-Rewrite Risk)

| Phase | Milestone | Concrete Deliverables | Verification Gate |
| :--- | :--- | :--- | :--- |
| **Phase 1** | **Monorepo & Local Infra Setup (`staging`)** | Configure `npm workspaces` + `turbo.json`; move Next.js app into `apps/web`; create `packages/shared` (pure scheduling math + Zod enums/DTOs); scaffold `apps/api` (NestJS + Swagger `/api/docs` + `/health` + `pino`); add `docker-compose.yml` (Postgres 16 + Redis 7 + API). | `apps/web` still builds cleanly; `apps/api` starts and `GET /health` returns `{ status: "ok", db: "up", redis: "up" }`. |
| **Phase 2** | **Prisma Schema, Postgres Constraints, Seed & Clerk Auth** | Translate all **19 tables** (minus `slotLocks`, moved to Redis) to `apps/api/prisma/schema.prisma` using `TIMESTAMPTZ` + `JSONB`; add raw SQL migration for `btree_gist` + `EXCLUDE USING GIST` constraints on `appointments`; port `seed.ts`; build `ClerkJwtGuard`, `RolesGuard`, `TenantAccessGuard`, `POST /webhooks/clerk`, `GET /users/me`, `POST /users/ensure`, and `ClerkService.syncPublicMetadata`. | `npx prisma migrate dev` + seed succeed; signed Clerk JWT resolves `req.user`; unauthorized/cross-tenant calls return `401`/`403`. |
| **Phase 3** | **Super Admin, Billing & Clinic Resource APIs** | Port `superAdmin.ts`, `subscriptions.ts`, `platformAnalytics.ts`, `clinicAdmin.ts`, and `invitations.ts` into NestJS modules with SQL MRR/ARR queries, `@AuditLog()` interceptor, `ClinicWriteGuard`, and `QuotaGuard`. | Supertest suite passes for clinic creation, plan quotas (`403 QUOTA_EXCEEDED`), payment recording, staff invitations, and read-only suspension mode. |
| **Phase 4** | **Scheduling Engine, Redis Lua Locks & Socket.IO** | Port `availability.ts`, `slotLocks.ts`, `appointments.ts`, `publicBooking.ts`, `patientPortal.ts`, and `waitlist.ts`; implement atomic Redis Lua interval locks, deterministic `FOR UPDATE` + `GIST` booking transactions, and Socket.IO (`clinic:<id>` + `public:clinic:<slug>`). | Concurrency Supertest firing 5 simultaneous bookings passes with **1 `201`** and **4 `409`**; overlapping duration lock test rejects partial overlap; Socket.IO emits check-in & slot updates. |
| **Phase 5** | **Clinical Charting, R2 Storage & Async Jobs/Crons** | Port `odontogram.ts`, `files.ts`, clinic logo & receipt uploads to Cloudflare R2 (presigned PUT/GET + `HeadObject` <= 500 KB check); port `emails/templates.ts` + Resend/Gmail SMTP dual transport; build BullMQ workers + `POST /internal/cron/:jobName` + GitHub Actions daily cron workflow. | Presigned X-ray upload verifies size & updates `storage_used_bytes`; private X-rays reject unauthenticated access; cron endpoints execute idempotently. |
| **Phase 6** | **Frontend Swap & $0/Month Production Deployment** | Replace **196 Convex hook calls** in `apps/web` with TanStack Query hooks + `src/lib/api-client.ts` + Socket.IO invalidation provider; remove `convex/` and Convex deps; update `AGENTS.md` for the new stack; deploy `apps/web` to Vercel Hobby and `apps/api` to Render Free (with Neon + Upstash + R2 + GitHub Actions Crons). | All 26 pages work end-to-end against `apps/api`; CI passes 100% of unit, integration, and concurrency tests at **$0.00/month**. |

---

## 7. $0/Month Production Deployment & Free-Tier Guardrails

| Infrastructure Component | Provider (Free Tier) | Monthly Allowance | Operational Guardrail |
| :--- | :--- | :--- | :--- |
| **Frontend (`apps/web`)** | [Vercel Hobby](https://vercel.com/docs/plans/hobby) | Free personal/portfolio hosting | Set Vercel Root Directory to `apps/web`; connects to `apps/api` via `NEXT_PUBLIC_API_URL`. |
| **Backend API (`apps/api`)** | [Render Free Web Service](https://render.com/hosting/nodejs) *(or Oracle Cloud Always Free ARM VM for zero cold-start)* | **750 free hours/month**, 512 MB RAM | Use `@prisma/adapter-pg` + `NODE_OPTIONS="--max-old-space-size=384"` to stay comfortably under 512 MB RAM. Daily crons triggered externally via GitHub Actions so Render sleep never drops a scheduled job. |
| **PostgreSQL 16** | [Neon Free Plan](https://neon.com/docs/introduction/plans) | **0.5–1 GB storage**, 100 CU-hours/mo + dev branches | Use pooled connection string (`-pooler`) for runtime queries and direct URL (`DIRECT_URL`) for `prisma migrate deploy`. |
| **Redis (Locks & Rate Limit)** | [Upstash Redis Free](https://upstash.com/pricing/redis) | **250 MB storage & 500,000 commands/mo** | Do **not** run continuous BullMQ polling loops against Upstash Free on Render; use Redis strictly for Lua slot locks, rate limiting, and short-TTL caching in prod (while full BullMQ runs in local Docker / always-on VM). |
| **Object Storage (3 Flows)** | [Cloudflare R2](https://www.cloudflare.com/products/r2/) | **10 GB/month storage & $0 egress** | Card verification on signup; $0 billed within 10 GB. Private bucket for X-rays/receipts (presigned GET/PUT); public custom domain or prefix for clinic logos. |
| **Scheduled Crons & CI** | **GitHub Actions** | 2,000 free mins/mo (unlimited on public repos) | Scheduled workflows invoke `POST /internal/cron/*` with `X-Cron-Secret` at the exact UTC schedules from `convex/crons.ts`. |
| **Auth & Transactional Email** | **Clerk** + **Resend** / **Gmail SMTP** | **10,000 MAU** + **3,000 emails/mo** (or Gmail App Password) | Reuses existing Clerk app (standard JWTs) and Resend/Gmail credentials. |

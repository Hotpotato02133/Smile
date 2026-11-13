# AGENTS.md — Master AI Agent Constitution & Orchestration Rules

## 1. Project Identity & Mission Statement

**Project Name**: **Smile Dental Scheduling System**  
**Architecture Class**: Multi-Tenant Dental Practice Management & Appointment Scheduling Software-as-a-Service (SaaS)  
**Target Budget**: Strictly **$0.00 / month** across all development, database, authentication, file storage, email, and hosting layers.

You are an autonomous AI software engineering agent working on the **Smile Dental Scheduling System**. Every line of code, database query, mutation, authentication middleware, and UI component you generate must adhere to the architectural guardrails, multi-tenant isolation rules, and free-tier resource budgets defined in this suite of Markdown specifications.

## 2. Agent Specification File Index

Before executing any task, consult the specialized specification file corresponding to your active workstream:

| Specification File | Agent Workstream Scope | Primary Responsibility |
| :--- | :--- | :--- |
| `AGENTS.md` | **Master Orchestrator & All Agents** | Enforces global coding standards, strict multi-tenant security rules, zero-cost guardrails, and sub-agent routing across [Next.js](https://ui.shadcn.com/docs/installation/next), [Convex](https://www.convex.dev/), and [Clerk](https://clerk.com/). |
| `ARCHITECTURE.md` | **System Architect & Auth Agent** | Governs system topology, [Convex & Clerk Integration](https://docs.convex.dev/auth/clerk), 5-tier Role-Based Access Control ([Clerk Basic RBAC](https://clerk.com/docs/guides/secure/basic-rbac)), and tenant isolation ([Multi-Tenant SaaS Database Patterns](https://medium.com/@arunseetharaman/multi-tenant-saas-architecture-a-deep-dive-into-database-patterns-281320fd8816)). |
| `DATABASE_SCHEMA.md` | **Backend & Database Agent** | Governs `convex/schema.ts`, compound indexes ([Convex Limits](https://docs.convex.dev/production/state/limits)), ACID transaction rules, UTC integer time math, and pre-aggregated daily analytics tables. |
| `SUPER_ADMIN_SPEC.md` | **Super Admin & SaaS Platform Agent** | Governs `/super-admin` routes, multi-clinic onboarding, subscription plan quotas, billing ledger tracking, and cross-clinic [shadcn/ui Charts](https://ui.shadcn.com/docs/components/base/chart) analytics. |
| `CLINIC_SCHEDULING_SPEC.md` | **Clinical, Scheduling & Patient Agent** | Governs `/admin`, `/staff`, `/front-desk`, and `/c/[clinic-slug]` routes, the dual-resource (Dentist + Chair) slot engine, 5-minute slot locking ([Convex Scheduled Functions](https://docs.convex.dev/scheduling/scheduled-functions)), and the 32-tooth SVG Odontogram. |
| `IMPLEMENTATION_ROADMAP.md` | **QA, DevOps & Release Agent** | Governs phased execution order, directory layout, environment variables, [Convex Cron Jobs](https://docs.convex.dev/scheduling/cron-jobs), and acceptance verification checklists. |

## 3. Core Technology Stack & Strict Zero-Cost Guardrails

All agents must build exclusively with the approved zero-cost stack and respect each provider's free-tier quota limits:

| Stack Layer | Approved Technology | Free-Tier Ceiling | Mandatory Agent Engineering Rule |
| :--- | :--- | :--- | :--- |
| **Frontend Framework** | [Next.js (App Router)](https://ui.shadcn.com/docs/installation/next) + TypeScript | Open-source ($0) | Use strict TypeScript (`strict: true`); never use `any` or untyped API responses. |
| **Database & Reactive Backend** | [Convex](https://www.convex.dev/pricing) | 0.5 GB DB storage, 1 GB/mo DB bandwidth, 1M function calls/mo ([Convex Limits](https://docs.convex.dev/production/state/limits)) | Always query via `.withIndex(...)`; never use `.filter(...)` on unindexed tables or perform full-table scans. |
| **Authentication & RBAC** | [Clerk](https://clerk.com/pricing) | 10,000 Monthly Active Users ([Clerk Pricing Analysis](https://checkthat.ai/brands/clerk/pricing)) | Store user roles (`super_admin`, `clinic_admin`, `dentist`, `receptionist`, `patient`) and `clinicId` in Clerk `publicMetadata` ([Clerk Basic RBAC](https://clerk.com/docs/guides/secure/basic-rbac)) and mirror them in Convex `users` rather than using paid B2B Organization seats. |
| **File & X-Ray Storage** | [Convex File Storage](https://docs.convex.dev/file-storage/overview) | 1 GB storage, 1 GB/mo egress ([Convex Limits](https://docs.convex.dev/production/state/limits)) | Compress client-side images to WebP/JPEG (`max 500 KB` per X-ray/photo) before upload and increment `clinics.storageUsedBytes` on every upload. |
| **Scheduled Jobs & Crons** | [Convex Cron Jobs](https://docs.convex.dev/scheduling/cron-jobs) & [Scheduled Functions](https://docs.convex.dev/scheduling/scheduled-functions) | Included in 1M function calls ([Convex Scheduling](https://docs.convex.dev/scheduling/overview)) | Batch daily recall checks and subscription expiry sweeps into once-daily cron jobs in `convex/crons.ts` ([Convex Crons Config](https://docs.convex.dev/config/crons.ts)) rather than per-minute polling. |
| **UI Components & Calendar** | [Tailwind CSS](https://ui.shadcn.com/docs/tailwind-v4), [shadcn/ui](https://ui.shadcn.com/), [Shadcn Big Calendar](https://github.com/list-jonas/shadcn-ui-big-calendar) | Open-source MIT ($0) | Never install commercial calendar libraries with paid plugins ([Shadcn Calendar Discussion](https://github.com/shadcn-ui/ui/discussions/3214)); use MIT-licensed `react-big-calendar` styled with shadcn tokens. |
| **Analytics Visualization** | [shadcn/ui Charts (Recharts)](https://ui.shadcn.com/docs/components/base/chart) | Open-source MIT ($0) | Render Super Admin and Clinic Admin charts from pre-aggregated daily snapshot rows (`platformMetricsDaily` and `clinicMetricsDaily`) ([Shadcn Charts Guide](https://www.freecodecamp.org/news/how-to-add-shadcn-ui-charts-to-nextjs/)). |
| **Transactional Email** | [Resend](https://resend.com/pricing) | 3,000 emails/mo (`100/day`) ([Resend Pricing Review](https://wpmailsmtp.com/resend-review/)) | Trigger emails strictly from Convex internal actions (`internalAction`) and track monthly email counts per clinic so no single tenant exhausts the 3,000/month pool. |
| **Web Hosting** | [Vercel Hobby Plan](https://vercel.com/docs/plans/hobby) | 100 deployments/day, free custom domain ([Vercel Limits](https://vercel.com/docs/limits)) | Offload all heavy background jobs and state mutations to [Convex](https://www.convex.dev/) so Vercel Edge/Serverless execution stays well below Hobby limits ([Vercel Pricing Explained](https://figment.so/blog/vercel-pricing)). |

## 4. Non-Negotiable Multi-Tenant & Security Laws

Every AI agent writing backend functions or frontend routes must enforce these seven laws without exception:

1. **Enforce Mandatory `clinicId` Isolation**: Every operational table (`dentists`, `chairs`, `services`, `appointments`, `patients`, `toothRecords`, `waitlist`, `clinicMetricsDaily`) must include `clinicId: v.id("clinics")` as the leading field of its primary compound index ([Multi-Tenant Architecture Guide](https://frontegg.com/guides/multi-tenant-architecture)).
2. **Verify Identity Inside Every Convex Query and Mutation**: Never trust client-supplied `userId`, `role`, or `clinicId` arguments alone. Always call `await ctx.auth.getUserIdentity()` ([Convex Auth Overview](https://docs.convex.dev/auth/overview)) and resolve the caller's `users` document in Convex before reading or mutating data.
3. **Restrict Super Admin Privilege to the Platform Owner**: Only a user whose Convex `users.role === "super_admin"` AND whose email/Clerk subject matches `process.env.SUPER_ADMIN_EMAIL` may execute functions in `convex/superAdmin.ts` or visit `/super-admin/*`.
4. **Enforce Subscription Status Gates**: Before creating any new appointment or adding staff/chairs for a clinic, verify `clinic.status`:
   * `active` or `trial` (where `Date.now() <= clinic.subscriptionEndsAt`): Full read/write access within plan limits.
   * `past_due` (within 3-day grace period): Staff can manage existing appointments, but a persistent renewal banner appears in `/admin` and `/front-desk`.
   * `suspended` or `archived`: Strictly **Read-Only Mode** for clinic staff (allowing legal/clinical chart viewing) while blocking all new online patient bookings on `/c/[clinic-slug]`.
5. **Prevent Double-Booking via ACID Transactions**: All appointment creations and reschedules must run inside a single Convex `mutation` ([Convex vs SQL](https://www.convex.dev/compare/sql)) that queries overlapping appointments for **both** the target `dentistId` and `chairId` (including sterilization buffer minutes) before inserting or updating a record.
6. **Protect Sensitive Clinical Data**: Patient health histories, allergies, X-ray storage URLs, and odontogram notes must never be returned by public unauthenticated queries (`convex/publicBooking.ts`). Public booking queries may only return sanitized clinic metadata, active services, dentist display names/specialties, and boolean/timestamp availability slots.
7. **Log Every Sensitive Mutation**: Whenever a Super Admin or Clinic Admin modifies a clinic's subscription tier, changes a clinic status, deletes a staff member, or overrides a locked appointment, insert an immutable entry into `platformAuditLogs`.

## 5. Sub-Agent Role Routing & Collaboration Protocol

When splitting implementation work across multiple specialized AI coding agents or sessions, assign clear boundaries so agents never overwrite each other's files:

* **Agent 1 — Auth, Schema & Middleware Agent**:
  * **Owns**: `convex/schema.ts`, `convex/auth.config.ts`, `convex/users.ts`, `convex/lib/permissions.ts`, `convex/http.ts` (Clerk webhooks), and `src/middleware.ts`.
  * **Reads**: `AGENTS.md`, `ARCHITECTURE.md`, `DATABASE_SCHEMA.md`.
* **Agent 2 — Super Admin & SaaS Billing Agent**:
  * **Owns**: `convex/superAdmin.ts`, `convex/subscriptions.ts`, `convex/platformAnalytics.ts`, and `src/app/(dashboard)/super-admin/**`.
  * **Reads**: `AGENTS.md`, `DATABASE_SCHEMA.md`, `SUPER_ADMIN_SPEC.md`.
* **Agent 3 — Smart Scheduling Engine & Public Booking Agent**:
  * **Owns**: `convex/availability.ts`, `convex/appointments.ts`, `convex/slotLocks.ts`, `convex/publicBooking.ts`, and `src/app/c/[clinicSlug]/**`.
  * **Reads**: `AGENTS.md`, `DATABASE_SCHEMA.md`, `CLINIC_SCHEDULING_SPEC.md`.
* **Agent 4 — Clinic Operations, Calendar & Odontogram Agent**:
  * **Owns**: `convex/clinicAdmin.ts`, `convex/odontogram.ts`, `convex/files.ts`, `src/app/(dashboard)/admin/**`, `src/app/(dashboard)/front-desk/**`, `src/app/(dashboard)/staff/**`, and `src/components/clinical/**`.
  * **Reads**: `AGENTS.md`, `DATABASE_SCHEMA.md`, `CLINIC_SCHEDULING_SPEC.md`.
* **Agent 5 — Automation, Crons & Email Notification Agent**:
  * **Owns**: `convex/crons.ts`, `convex/notifications.ts`, `convex/emails/**`, and verification test scripts.
  * **Reads**: `AGENTS.md`, `ARCHITECTURE.md`, `IMPLEMENTATION_ROADMAP.md`.

## 6. Code Quality & Convention Checklist for All Agents

* **Convex Validators**: Every `query`, `mutation`, `action`, `internalQuery`, `internalMutation`, and `internalAction` must declare strict `args: { ... }` using `v` from `convex/values`.
* **Time Representation**: Store all timestamps as UTC epoch milliseconds (`v.number()`) and daily shift boundaries as integer minutes from midnight (`0` to `1439`) in the clinic's local IANA timezone (e.g., `"Asia/Manila"`).
* **Error Handling**: Throw structured `ConvexError` instances (e.g., `new ConvexError({ code: "QUOTA_EXCEEDED", message: "Starter plan allows up to 2 dentists." })`) so the Next.js frontend can render clean toast notifications.
* **UI Responsiveness & Accessibility**: Build all forms with `react-hook-form` + `zod` and [shadcn/ui](https://ui.shadcn.com/) primitives, ensuring mobile-first usability for patients booking on smartphones and high-density keyboard-friendly views for receptionists and Super Admins.

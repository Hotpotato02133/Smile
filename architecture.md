# ARCHITECTURE.md — System Architecture, Auth & Multi-Tenancy Specification

## 1. High-Level System Topology

The **Smile Dental Scheduling System** uses a serverless, reactive, multi-tenant architecture built on [Next.js (App Router)](https://ui.shadcn.com/docs/installation/next), [Convex](https://www.convex.dev/), [Clerk](https://clerk.com/), and [Resend](https://resend.com/pricing), hosted on the [Vercel Hobby Plan](https://vercel.com/docs/plans/hobby).

| Architectural Tier | Component | Primary Function |
| :--- | :--- | :--- |
| **Edge & Routing Tier** | [Next.js Proxy (`src/proxy.ts`)](https://ui.shadcn.com/docs/installation/next) + [Clerk Middleware](https://clerk.com/docs/guides/secure/basic-rbac) | Inspects JWT session claims at the edge, enforces role-based route protection (`/super-admin`, `/admin`, `/front-desk`, `/staff`, `/patient`), and resolves public clinic slugs (`/c/[clinicSlug]`). |
| **Client Reactive State** | `ConvexProviderWithClerk` ([Convex & Clerk](https://docs.convex.dev/auth/clerk)) | Maintains persistent WebSocket subscriptions so calendar changes, patient check-ins, and Super Admin metrics update across all connected browsers in real time ([Convex Pricing & Features](https://www.convex.dev/pricing)). |
| **Transactional Compute Tier** | [Convex Queries & Mutations](https://www.convex.dev/compare/sql) | Executes ACID-compliant TypeScript transactions for slot calculation, conflict-free appointment booking, odontogram updates, and subscription enforcement. |
| **Asynchronous & Scheduled Tier** | [Convex Scheduled Functions](https://docs.convex.dev/scheduling/scheduled-functions) & [Cron Jobs](https://docs.convex.dev/scheduling/cron-jobs) | Releases expired 5-minute booking holds, aggregates daily SaaS metrics, checks subscription expirations, and triggers [Resend](https://resend.com/pricing) emails via `internalAction`. |
| **Blob & Media Tier** | [Convex File Storage](https://docs.convex.dev/file-storage/overview) | Stores compressed dental X-rays, intraoral photos, clinic logos, and subscription payment receipts via signed upload/download URLs. |

## 2. Multi-Tenant Isolation Model (`clinicId` Shared-Schema Pattern)

To avoid paying per-organization fees while scaling to unlimited dental clinics, the platform implements the **Shared Database, Shared Schema with Mandatory `clinicId`** pattern ([Multi-Tenant SaaS Database Patterns](https://medium.com/@arunseetharaman/multi-tenant-saas-architecture-a-deep-dive-into-database-patterns-281320fd8816)):

1. **Tenant Root Entity (`clinics` Table)**:
   * Every onboarded dental practice is represented by a document in the `clinics` table with a globally unique `slug` (e.g., `"smile-care-iligan"`) and `Id<"clinics">`.
   * Public patients access a clinic's booking portal at `/c/[clinicSlug]`, or browse all active clinics on the platform directory `/clinics`.
2. **Tenant Context Resolution for Staff (`users.clinicId`)**:
   * Every `clinic_admin`, `dentist`, and `receptionist` account belongs to a specific `clinicId` stored in both their Convex `users` record and their Clerk `publicMetadata` ([Clerk Basic RBAC](https://clerk.com/docs/guides/secure/basic-rbac)).
   * When a staff member queries or mutates data, the backend helper `requireClinicAccess(ctx, allowedRoles)` reads the authenticated user's `clinicId` from the database—never trusting a client-passed `clinicId` unless the caller is verified as `super_admin` in "View As Clinic" mode.
3. **Patient Multi-Clinic Flexibility**:
   * A patient (`role: "patient"`) has a single global Clerk identity ([Clerk Authentication](https://clerk.com/)) and can book appointments at one or multiple clinics on the platform.
   * Each clinic maintains its own clinical patient chart (`patients` table scoped by `by_clinic_and_user`) so clinical notes and odontograms remain strictly isolated per dental practice ([Multi-Tenant Architecture Guide](https://frontegg.com/guides/multi-tenant-architecture)).

## 3. Authentication & 5-Tier RBAC Flow (Clerk + Convex)

### 3.1 Clerk Session Token & Metadata Configuration

In the [Clerk Dashboard](https://clerk.com/docs/guides/development/integrations/databases/convex):
1. Create a JWT template named **`convex`**.
2. Add custom claims to the session token so both Next.js Middleware and Convex `ctx.auth.getUserIdentity()` can inspect roles immediately:
   ```json
   {
     "role": "{{user.public_metadata.role}}",
     "clinicId": "{{user.public_metadata.clinicId}}"
   }
   ```
3. Configure `convex/auth.config.ts` ([Convex & Clerk Docs](https://docs.convex.dev/auth/clerk)):
   ```typescript
   export default {
     providers: [
       {
         domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
         applicationID: "convex",
       },
     ],
   };
   ```

### 3.2 Clerk-to-Convex Webhook Synchronization (`convex/http.ts`)

Whenever a user signs up or has their metadata updated in Clerk, an HTTP action at `/clerk-users-webhook` verifies the Svix signature and upserts the `users` table in Convex:
* If `email === process.env.SUPER_ADMIN_EMAIL`, automatically assign `role: "super_admin"`.
* If the user's email matches a pending invitation in `staffInvitations`, automatically assign their invited `role` (`clinic_admin`, `dentist`, or `receptionist`) and `clinicId`, and mark the invitation `accepted`.
* Otherwise, default new sign-ups to `role: "patient"`.

### 3.3 Central Backend Authorization Helper (`convex/lib/permissions.ts`)

All agents must import and call these authorization guards at the top of every Convex query and mutation:

```typescript
import { QueryCtx, MutationCtx } from "../_generated/server";
import { ConvexError } from "convex/values";
import { Id } from "../_generated/dataModel";

export type UserRole =
  | "super_admin"
  | "clinic_admin"
  | "dentist"
  | "receptionist"
  | "patient";

export async function getAuthenticatedUser(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError({ code: "UNAUTHENTICATED", message: "Sign-in required." });
  }
  const user = await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
    .unique();

  if (!user || !user.isActive) {
    throw new ConvexError({ code: "FORBIDDEN", message: "User account is inactive or missing." });
  }
  return user;
}

export async function requireSuperAdmin(ctx: QueryCtx | MutationCtx) {
  const user = await getAuthenticatedUser(ctx);
  if (user.role !== "super_admin") {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "Super Admin privileges required.",
    });
  }
  return user;
}

export async function requireClinicAccess(
  ctx: QueryCtx | MutationCtx,
  allowedRoles: UserRole[],
  overrideClinicId?: Id<"clinics">
) {
  const user = await getAuthenticatedUser(ctx);

  // Super Admin can inspect any clinic when passing overrideClinicId
  if (user.role === "super_admin" && overrideClinicId) {
    const clinic = await ctx.db.get(overrideClinicId);
    if (!clinic) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Target clinic not found." });
    }
    return { user, clinic, clinicId: clinic._id, isSuperAdminOverride: true };
  }

  if (!allowedRoles.includes(user.role) || !user.clinicId) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "Insufficient role permissions for this clinic operation.",
    });
  }

  const clinic = await ctx.db.get(user.clinicId);
  if (!clinic) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Assigned clinic does not exist." });
  }

  return { user, clinic, clinicId: clinic._id, isSuperAdminOverride: false };
}
```

## 4. Subscription & Quota Enforcement Architecture

Every clinic is linked to a `subscriptionPlans` document (`Trial`, `Starter`, `Pro`). To keep the platform profitable and prevent noisy-neighbor resource exhaustion ([Multi-Tenant SaaS Guide](https://createxp.in/blogs/multi-tenant-saas-architecture-database-guide)), mutations must validate plan quotas via `assertClinicCanWrite(ctx, clinicId, resourceType)`:

| Resource Type | Quota Field in `subscriptionPlans` | Enforcement Trigger Point |
| :--- | :--- | :--- |
| **Clinic Subscription State** | `clinics.status` & `clinics.subscriptionEndsAt` | Checked on every write mutation; blocks new appointments if `status === "suspended"` or `status === "archived"`. |
| **Active Dentists** | `maxDentists` | Checked in `clinicAdmin:createDentist` before inserting a new `dentists` row. |
| **Dental Chairs / Operatories** | `maxChairs` | Checked in `clinicAdmin:createChair` before inserting a new `chairs` row. |
| **Monthly Appointments** | `maxAppointmentsPerMonth` | Checked in `appointments:create` against `clinics.currentMonthAppointmentCount`. |
| **File & X-Ray Storage** | `maxStorageBytes` | Checked in `files:generateUploadUrl` against `clinics.storageUsedBytes` ([Convex File Storage](https://docs.convex.dev/file-storage/overview)). |
| **Monthly Transactional Emails** | `maxEmailsPerMonth` | Checked in `notifications:sendClinicEmail` against `clinics.currentMonthEmailCount` ([Resend Pricing](https://resend.com/pricing)). |
| **Feature Flags** | `clinics.featureFlags` | Gates access to `odontogramEnabled`, `xrayStorageEnabled`, `waitlistAutomationEnabled`, and `recallAutomationEnabled`. |

## 5. Repository Directory Map

| Path | Owned By Agent | Purpose |
| :--- | :--- | :--- |
| `convex/schema.ts` | Agent 1 (Schema & Auth) | Complete 19-table multi-tenant database schema and compound indexes ([Convex Limits](https://docs.convex.dev/production/state/limits)). |
| `convex/auth.config.ts`, `convex/http.ts` & `src/proxy.ts` | Agent 1 (Schema & Auth) | Clerk JWT issuer configuration, Svix webhook receiver (`/clerk-users-webhook`), and Next.js 16 RBAC route proxy. |
| `convex/lib/permissions.ts` | Agent 1 (Schema & Auth) | Centralized RBAC helpers (`requireSuperAdmin`, `requireClinicAccess`, `assertClinicCanWrite`, `assertClinicFeatureEnabled`). |
| `convex/superAdmin.ts` & `convex/subscriptions.ts` | Agent 2 (Super Admin) | Multi-clinic provisioning, status toggles, subscription plans, and payment ledger mutations. |
| `convex/platformAnalytics.ts` | Agent 2 (Super Admin) | Pre-aggregated MRR, clinic leaderboard, and free-tier quota utilization queries. |
| `convex/availability.ts` & `convex/slotLocks.ts` | Agent 3 (Scheduling Engine) | Dual-resource (Dentist + Chair) slot calculation and 5-minute temporary slot holds ([Convex Scheduled Functions](https://docs.convex.dev/scheduling/scheduled-functions)). |
| `convex/appointments.ts` & `convex/waitlist.ts` | Agent 3 (Scheduling Engine) | Booking creation, check-in status transitions, rescheduling, and cancellation waitlist claims. |
| `convex/clinicAdmin.ts` & `convex/odontogram.ts` | Agent 4 (Clinic & Clinical) | Dentist, chair, service CRUD, and 32-tooth interactive dental chart records. |
| `convex/files.ts` | Agent 4 (Clinic & Clinical) | [Convex File Storage](https://docs.convex.dev/file-storage/overview) signed upload/download URLs and byte-quota tracking. |
| `convex/crons.ts` & `convex/notifications.ts` | Agent 5 (Automation & QA) | Daily subscription sweeps, analytics rollups ([Convex Cron Jobs](https://docs.convex.dev/scheduling/cron-jobs)), and [Resend](https://resend.com/pricing) emails. |
| `src/app/(dashboard)/super-admin/**` | Agent 2 (Super Admin) | Personal Super Admin SaaS dashboard, clinic onboarding, billing tracker, and [shadcn/ui Charts](https://ui.shadcn.com/docs/components/base/chart). |
| `src/app/(dashboard)/admin/**` | Agent 4 (Clinic & Clinical) | Clinic Admin setup portal for dentists, chairs, procedure prices, and local reports. |
| `src/app/(dashboard)/front-desk/**` | Agent 4 (Clinic & Clinical) | Receptionist [Shadcn Big Calendar](https://github.com/list-jonas/shadcn-ui-big-calendar) and live check-in Kanban board. |
| `src/app/(dashboard)/staff/**` | Agent 4 (Clinic & Clinical) | Dentist daily chair queue, interactive 32-tooth SVG Odontogram, and X-ray viewer. |
| `src/app/(public)/c/[clinicSlug]/**` | Agent 3 (Scheduling Engine) | Public clinic landing page and 4-step patient online booking wizard. |

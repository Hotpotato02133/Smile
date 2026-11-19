# IMPLEMENTATION_ROADMAP.md — Phased Execution Plan, Setup & Agent Verification Checklist

## 1. Environment & Project Initialization

Execute these commands in order to scaffold the **Smile Dental Scheduling System** with [Next.js](https://ui.shadcn.com/docs/installation/next), [Convex](https://www.convex.dev/), [Clerk](https://clerk.com/), [Tailwind CSS](https://ui.shadcn.com/docs/tailwind-v4), [shadcn/ui](https://ui.shadcn.com/), and [Resend](https://resend.com/pricing):

```bash
# 1. Initialize Next.js with TypeScript, Tailwind CSS, and App Router
npx create-next-app@latest smile-dental-scheduling-system --typescript --tailwind --eslint --app --src-dir

cd smile-dental-scheduling-system

# 2. Install Convex, Clerk, Calendar, Forms, Icons, and Email packages
npm install convex @clerk/nextjs svix resend lucide-react date-fns date-fns-tz react-big-calendar zod react-hook-form @hookform/resolvers
npm install -D @types/react-big-calendar

# 3. Initialize shadcn/ui and add core components + Recharts chart primitives
npx shadcn@latest init
npx shadcn@latest add button card dialog dropdown-menu form input label select badge tabs table sheet switch avatar alert separator sonner chart calendar popover

# 4. Initialize Convex project
npx convex dev
```

## 2. Required Environment Variables

Configure these variables in `.env.local` (for local Next.js development) and inside the **Convex Dashboard → Settings → Environment Variables** ([Convex & Clerk Integration](https://docs.convex.dev/auth/clerk)):

| Variable Name | Location | Purpose |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_CONVEX_URL` | `.env.local` & Vercel | Public WebSocket endpoint for your [Convex](https://www.convex.dev/) deployment. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `.env.local` & Vercel | Public key from your [Clerk Dashboard](https://clerk.com/). |
| `CLERK_SECRET_KEY` | `.env.local` & Vercel | Server-side secret key for Clerk middleware and metadata updates. |
| `CLERK_JWT_ISSUER_DOMAIN` | Convex Dashboard | Issuer URL from your Clerk `convex` JWT template ([Integrate Convex with Clerk](https://clerk.com/docs/guides/development/integrations/databases/convex)). |
| `CLERK_WEBHOOK_SECRET` | Convex Dashboard | Svix signing secret for `/clerk-users-webhook` in `convex/http.ts`. |
| `SUPER_ADMIN_EMAIL` | Convex Dashboard & `.env.local` | Your personal email address—automatically granted `super_admin` authority on sign-up. |
| `RESEND_API_KEY` | Convex Dashboard | API key from [Resend](https://resend.com/pricing) for sending transactional confirmations and renewal alerts. |

## 3. Six-Phase Implementation Sequence for AI Coding Agents

Execute these six milestones sequentially so every downstream UI has its database tables, types, and RBAC guards ready:

| Phase | Milestone Name | Deliverables & Files to Complete | Verification Gate |
| :--- | :--- | :--- | :--- |
| **Phase 1** | **Database Schema, Auth & RBAC Core** | `convex/schema.ts`, `convex/auth.config.ts`, `convex/http.ts`, `convex/lib/permissions.ts`, `convex/seed.ts`, and `src/proxy.ts`. | Signing in with `SUPER_ADMIN_EMAIL` creates a `users` row with `role: "super_admin"` and redirects to `/super-admin`. |
| **Phase 2** | **Super Admin Command Center & SaaS Billing** | `convex/superAdmin.ts`, `convex/subscriptions.ts`, `convex/platformAnalytics.ts`, and `src/app/(dashboard)/super-admin/**` (Clinics CRUD, Subscription Ledger, [shadcn/ui Charts](https://ui.shadcn.com/docs/components/base/chart) KPI dashboard, Audit Logs). | Super Admin can provision a new clinic, assign a `Trial` or `Pro` plan, record a `GCash`/`Bank Transfer` invoice, toggle clinic status to `Suspended`, and inspect MRR & storage gauges. |
| **Phase 3** | **Clinic Admin Setup & Resource Configuration** | `convex/clinicAdmin.ts` and `src/app/(dashboard)/admin/**` (Dentist profiles & weekly shift schedules, Operatory Chairs, Dental Services catalog with buffer times, and Clinic branding/hours). | Adding a 3rd dentist on a `Starter` plan (`maxDentists: 2`) throws a clean `QUOTA_EXCEEDED` error prompting an upgrade. |
| **Phase 4** | **Dual-Resource Slot Engine & Public Patient Booking** | `convex/availability.ts`, `convex/slotLocks.ts`, `convex/publicBooking.ts`, and `src/app/(public)/c/[clinicSlug]/**` (4-step booking wizard, 5-minute real-time slot lock, family dependent selector, medical intake). | Selecting a 10:00 AM slot on Browser A immediately hides or locks that dentist/chair pair on Browser B for 5 minutes via [Convex](https://www.convex.dev/pricing). |
| **Phase 5** | **Front-Desk Kanban & Dentist 32-Tooth Odontogram** | `convex/appointments.ts`, `convex/odontogram.ts`, `convex/files.ts`, `src/app/(dashboard)/front-desk/**` ([Shadcn Big Calendar](https://github.com/list-jonas/shadcn-ui-big-calendar) + Check-In Kanban), and `src/app/(dashboard)/staff/**` (Interactive 32-tooth SVG Odontogram + compressed X-ray uploader). | Checking a patient in on `/front-desk` updates the dentist's `/staff` view in real time; clicking Tooth #14 Occlusal saves `caries` and updates the SVG color immediately. |
| **Phase 6** | **Crons, Recall Automation & Production Hardening** | `convex/crons.ts` ([Convex Cron Jobs](https://docs.convex.dev/scheduling/cron-jobs)), `convex/notifications.ts` ([Resend](https://resend.com/pricing)), `convex/waitlist.ts`, and deployment to [Vercel Hobby Plan](https://vercel.com/docs/plans/hobby). | Daily crons roll up `platformMetricsDaily`, transition expired trials to `past_due`, and send 24h reminders and 6-month hygiene recall emails. |

## 4. Pre-Release Agent Verification & QA Checklist

Before marking the **Smile Dental Scheduling System** complete, run through every verification check below:

* [ ] **Tenant Data Isolation Check**: Verify that a `clinic_admin`, `dentist`, or `receptionist` from `Clinic A` cannot read or mutate appointments, patients, or tooth records from `Clinic B` even by manually tampering with IDs in browser devtools ([Multi-Tenant Architecture Guide](https://frontegg.com/guides/multi-tenant-architecture)).
* [ ] **Super Admin Impersonation / Read-Only Check**: Confirm that when the Super Admin opens `/admin?viewAsClinicId=...`, all write buttons are disabled or blocked cleanly while full schedule and setup visibility works.
* [ ] **Subscription Suspension Gate Check**: Set a test clinic's status to `suspended` in `/super-admin/clinics` and confirm `/c/[clinic-slug]` blocks new patient bookings while `/staff` still allows viewing existing patient charts in read-only mode.
* [ ] **Dual-Resource Conflict Check**: Book `Dr. Santos` in `Chair 1` from `09:00–09:45` (+ `15 min` sterilization buffer = `10:00`). Verify that `09:45` is unavailable for `Dr. Santos` AND unavailable for `Chair 1`, while `Dr. Reyes` in `Chair 2` remains bookable at `09:45`.
* [ ] **Free-Tier Quota Protection Check**: Verify that uploading an X-ray image compresses the file below `500 KB` on the client, increments `clinics.storageUsedBytes` in [Convex File Storage](https://docs.convex.dev/file-storage/overview), and updates the Super Admin storage gauge on `/super-admin`.

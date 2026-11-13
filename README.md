# Smile Dental Scheduling System

Multi-tenant dental practice management and appointment scheduling SaaS built on a strictly zero-cost stack: **Next.js (App Router)**, **TypeScript**, **Tailwind CSS v4**, **shadcn/ui**, **Convex**, **Clerk**, and **Resend**.

## Architecture & Specification Docs

- [`agents.md`](./agents.md) — Master AI agent constitution, zero-cost guardrails, multi-tenant security laws, and sub-agent routing.
- [`architecture.md`](./architecture.md) — System topology, Clerk + Convex RBAC flow, tenant isolation, and repository map.
- [`database_schema.md`](./database_schema.md) — Complete 19-table Convex schema (`convex/schema.ts`), compound indexes, and initial seed requirements.
- [`clinic_scheduling_spec.md`](./clinic_scheduling_spec.md) — Dual-resource (Dentist + Operatory Chair) slot engine, 5-minute slot locking, front-desk Kanban, and 32-tooth SVG Odontogram.
- [`implementation_roadmap.md`](./implementation_roadmap.md) — Phased execution roadmap, environment variable setup, and pre-release QA checklist.

## Getting Started

1. **Copy environment variables:**
   ```bash
   cp .env.example .env.local
   ```
   Fill in your Clerk, Convex, Resend, and `SUPER_ADMIN_EMAIL` values (see [`implementation_roadmap.md`](./implementation_roadmap.md#2-required-environment-variables)).

2. **Initialize Convex & push schema:**
   ```bash
   npx convex dev
   ```

3. **Run the Next.js development server:**
   ```bash
   npm run dev
   ```

4. **Verify lint, typecheck, and production build:**
   ```bash
   npm run lint
   npx tsc --noEmit
   npm run build
   ```

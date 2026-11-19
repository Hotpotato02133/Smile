# SUPER_ADMIN_SPEC.md — Super Admin Command Center, SaaS Billing & Platform Analytics Specification

## 1. Access Control & Security Boundary (`/super-admin`)

The `/super-admin` portal is strictly reserved for the single platform owner and is never accessible to clinic staff or patients:

1. **Dual Identity Verification (Law #3)**:
   * Edge routing in `src/proxy.ts` restricts `/super-admin(.*)` to sessions with `role === "super_admin"`.
   * Every Convex query and mutation in `convex/superAdmin.ts`, `convex/subscriptions.ts`, and `convex/platformAnalytics.ts` MUST call `await requireSuperAdmin(ctx)` from `convex/lib/permissions.ts`, verifying both `user.role === "super_admin"` AND `user.email === process.env.SUPER_ADMIN_EMAIL`.
2. **Read-Only "View As Clinic" Impersonation**:
   * Super Admins can inspect any tenant's schedule, setup, and reports via `/admin?viewAsClinicId=<clinicId>`, `/front-desk?viewAsClinicId=<clinicId>`, or `/staff?viewAsClinicId=<clinicId>`.
   * Backend queries pass `overrideClinicId` to `requireClinicAccess(ctx, allowedRoles, overrideClinicId)` which returns `isSuperAdminOverride: true`.
   * All clinic-level write mutations MUST reject calls when `isSuperAdminOverride === true` (and the UI must render a top banner + disable write controls) so platform support can inspect tenant state without accidentally altering clinical records.
3. **Immutable Audit Trail (Law #7)**:
   * Every mutation in `convex/superAdmin.ts` and `convex/subscriptions.ts` MUST append an immutable document to `platformAuditLogs` capturing `actorUserId`, `actorRole`, optional `clinicId`, `actionType`, `targetEntity`, `targetId`, `metadataJson`, and `createdAt`.

## 2. Super Admin KPI Dashboard (`/super-admin`)

Designed to render instantly with zero full-table scans by reading pre-aggregated rows from `platformMetricsDaily` and live counters on `clinics`:

1. **Top-Line SaaS KPI Cards**:
   * **Monthly Recurring Revenue (MRR)** & **Annual Run Rate (ARR)** in `PHP`.
   * **Active Paid Clinics** vs. **Trial**, **Past Due**, and **Suspended** tenant counts.
   * **Platform Appointments (Today / 30d)** with completion and no-show percentages.
   * **Collected Revenue (This Month)** summed from `subscriptionPayments` with `status === "paid"`.
2. **Interactive Charts (`shadcn/ui Charts` / Recharts)**:
   * **MRR & Collected Revenue Trend** (Area/Line chart over the last 30/90 days from `platformMetricsDaily`).
   * **Clinic Status & Plan Distribution** (Bar/Donut chart across `trial`, `starter`, `pro`, `enterprise`).
   * **Cross-Clinic Appointment Volume** (Stacked bar chart: `completed`, `cancelled`, `noShow`).
3. **Free-Tier Resource Quota Gauges (Zero-Cost Guardrails)**:
   * **Convex File Storage Gauge**: Total `sum(clinics.storageUsedBytes)` vs. the **1 GB** free-tier ceiling, highlighting the top storage-consuming clinics.
   * **Resend Monthly Email Gauge**: Total `sum(clinics.currentMonthEmailCount)` vs. the **3,000 emails/month** ceiling (`100/day`).
   * **Clinic Leaderboard Table**: Top tenants ranked by `currentMonthAppointmentCount`, `lifetimeAppointmentCount`, and `storageUsedBytes`, with quick links to clinic details and Read-Only "View As Clinic".

## 3. Multi-Clinic Onboarding & Tenant Management (`/super-admin/clinics`)

Enables zero-touch or concierge provisioning of dental practices:

1. **Provision New Clinic Wizard (`superAdmin:createClinic`)**:
   * Captures clinic identity (`name`, unique URL `slug` for `/c/[slug]`, `tagline`, `primaryColorHex`), contact info (`email`, `phone`, `address`, `city`, `province`, `timezone` defaulting to `"Asia/Manila"`), and initial Clinic Admin email.
   * Selects a `subscriptionPlans` tier (`trial`, `starter`, `pro`, or `enterprise`) and `billingCycle` (`trial`, `monthly`, `annual`), automatically populating `featureFlags` from `plan.defaultFeatures`, setting `subscriptionStartsAt` / `subscriptionEndsAt` (and `trialEndsAt` for trials), and initializing quota counters to `0`.
   * Seeds default operating hours (Mon–Sat `09:00–17:00`, Sun closed) and copies `DEFAULT_SERVICE_CATALOG` (`convex/lib/serviceCatalog.ts`) into `services` for the new clinic.
   * Creates a pending `staffInvitations` row (`role: "clinic_admin"`, 7-day expiry) so the clinic owner automatically receives `clinic_admin` access when they sign up via Clerk.
   * Logs `"CLINIC_CREATED"` in `platformAuditLogs`.
2. **Clinic Lifecycle & Feature Flag Controls (`superAdmin:updateClinicStatus`, `superAdmin:updateClinicFeatures`, `superAdmin:changeClinicPlan`)**:
   * Transition clinic `status` between `trial`, `active`, `past_due`, `suspended`, and `archived`.
   * Setting `status` to `suspended` or `archived` immediately places clinic staff in **Read-Only Mode** and blocks new public bookings on `/c/[slug]`.
   * Override individual `featureFlags` (`odontogramEnabled`, `xrayStorageEnabled`, `waitlistAutomationEnabled`, `recallAutomationEnabled`, `customBrandingEnabled`) per clinic without changing its base plan.
   * Every change appends an immutable `platformAuditLogs` entry (`CLINIC_STATUS_CHANGED`, `CLINIC_PLAN_CHANGED`, `CLINIC_FEATURES_UPDATED`).

## 4. Subscription Plans & Billing Ledger (`/super-admin/billing` & `/super-admin/plans`)

Because Philippine dental clinics frequently pay via local rails rather than credit cards, Smile supports a manual-verified SaaS billing ledger with zero payment-gateway fees:

1. **Subscription Plan Management (`subscriptions:listPlans`, `subscriptions:upsertPlan`)**:
   * View and edit plan pricing (`monthlyPricePhp`, `annualPricePhp`), `trialDays`, resource quotas (`maxDentists`, `maxChairs`, `maxAppointmentsPerMonth`, `maxStorageBytes`, `maxEmailsPerMonth`), and `defaultFeatures`.
2. **Manual Payment & Invoice Ledger (`subscriptions:recordPayment`, `subscriptions:listPayments`)**:
   * Record payments with `paymentMethod` (`gcash`, `maya`, `bank_transfer`, `card`, `cash`, `manual_waiver`), `referenceNumber`, optional compressed receipt image (`receiptStorageId` in Convex File Storage), `billingCycle`, `amountPhp`, and `periodStart` / `periodEnd`.
   * Generates sequential human-readable invoice numbers (`INV-YYYY-NNNNN`).
   * Recording a `"paid"` payment automatically extends the clinic's `subscriptionEndsAt` to `periodEnd`, updates `planId` and `billingCycle`, clears `gracePeriodEndsAt`, and restores `past_due` or `suspended` clinics to `active`.
   * Logs `"SUBSCRIPTION_PAYMENT_RECORDED"` / `"SUBSCRIPTION_RENEWED"` in `platformAuditLogs`.
3. **Renewal Queue**:
   * Filtered list of clinics expiring within 7 days (via `clinics.by_subscription_end`) or currently in `past_due` status, with one-click "Record Renewal Payment".

## 5. System Announcements & Platform Audit Logs (`/super-admin/announcements` & `/super-admin/audit-logs`)

1. **System Announcements (`superAdmin:listAnnouncements`, `superAdmin:createAnnouncement`, `superAdmin:toggleAnnouncement`)**:
   * Broadcast banners (`info`, `warning`, `critical`) targeted to `all_clinic_staff`, `clinic_admins_only`, or `all_users`, with optional `expiresAt`.
2. **Audit Log Explorer (`superAdmin:listAuditLogs`)**:
   * Paginated, reverse-chronological viewer querying `platformAuditLogs` via `by_created_at`, `by_clinic_and_date`, or `by_actor`, displaying actor, action type, target entity, timestamp, and formatted `metadataJson`.

## 6. Backend Module & Function Contract

| Module | Functions | Indexes Used |
| :--- | :--- | :--- |
| `convex/superAdmin.ts` | `listClinics`, `getClinicDetail`, `createClinic`, `updateClinicStatus`, `changeClinicPlan`, `updateClinicFeatures`, `inviteClinicAdmin`, `listAnnouncements`, `createAnnouncement`, `toggleAnnouncement`, `listAuditLogs` | `clinics.by_slug`, `clinics.by_status`, `clinics.by_subscription_end`, `staffInvitations.by_clinic`, `systemAnnouncements.by_active`, `platformAuditLogs.by_created_at`, `platformAuditLogs.by_clinic_and_date` |
| `convex/subscriptions.ts` | `listPlans`, `updatePlan`, `listPayments`, `recordPayment`, `updatePaymentStatus`, `generateReceiptUploadUrl`, `getReceiptUrl` | `subscriptionPlans.by_code`, `subscriptionPayments.by_clinic`, `subscriptionPayments.by_status`, `subscriptionPayments.by_paid_at` |
| `convex/platformAnalytics.ts` | `getDashboardOverview`, `getDailyMetricsSeries`, `getClinicLeaderboard`, `getFreeTierUsage` | `platformMetricsDaily.by_date`, `clinics.by_status`, `clinics.by_subscription_end` |

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // ============================================================================
  // 1. SAAS PLATFORM & SUPER ADMIN TABLES
  // ============================================================================

  subscriptionPlans: defineTable({
    code: v.union(
      v.literal("trial"),
      v.literal("starter"),
      v.literal("pro"),
      v.literal("enterprise")
    ),
    name: v.string(),
    description: v.string(),
    monthlyPricePhp: v.number(),
    annualPricePhp: v.number(),
    trialDays: v.number(),
    // Enforced Resource Quotas
    maxDentists: v.number(),
    maxChairs: v.number(),
    maxAppointmentsPerMonth: v.number(),
    maxStorageBytes: v.number(),
    maxEmailsPerMonth: v.number(),
    // Default Feature Flags for this Tier
    defaultFeatures: v.object({
      odontogramEnabled: v.boolean(),
      xrayStorageEnabled: v.boolean(),
      waitlistAutomationEnabled: v.boolean(),
      recallAutomationEnabled: v.boolean(),
      customBrandingEnabled: v.boolean(),
    }),
    isActive: v.boolean(),
  }).index("by_code", ["code"]),

  clinics: defineTable({
    name: v.string(),
    slug: v.string(), // Unique URL identifier: /c/[slug]
    tagline: v.optional(v.string()),
    logoStorageId: v.optional(v.id("_storage")),
    primaryColorHex: v.string(), // e.g., "#0284c7"
    email: v.string(),
    phone: v.string(),
    address: v.string(),
    city: v.string(),
    province: v.string(),
    timezone: v.string(), // Default: "Asia/Manila"
    ownerUserId: v.optional(v.id("users")),

    // SaaS Subscription & Billing State (Managed by Super Admin)
    planId: v.id("subscriptionPlans"),
    status: v.union(
      v.literal("trial"),
      v.literal("active"),
      v.literal("past_due"),
      v.literal("suspended"),
      v.literal("archived")
    ),
    billingCycle: v.union(v.literal("monthly"), v.literal("annual"), v.literal("trial")),
    trialEndsAt: v.optional(v.number()),
    subscriptionStartsAt: v.number(),
    subscriptionEndsAt: v.number(),
    gracePeriodEndsAt: v.optional(v.number()),

    // Per-Clinic Feature Flag Overrides (Super Admin can toggle per tenant)
    featureFlags: v.object({
      odontogramEnabled: v.boolean(),
      xrayStorageEnabled: v.boolean(),
      waitlistAutomationEnabled: v.boolean(),
      recallAutomationEnabled: v.boolean(),
      customBrandingEnabled: v.boolean(),
    }),

    // Live Resource Quota Counters (Prevents expensive count(*) scans)
    activeDentistCount: v.number(),
    activeChairCount: v.number(),
    currentMonthKey: v.string(), // e.g., "2026-11"
    currentMonthAppointmentCount: v.number(),
    currentMonthEmailCount: v.number(),
    storageUsedBytes: v.number(),
    lifetimeAppointmentCount: v.number(),

    // Scheduling Policies
    slotIntervalMinutes: v.number(), // 15 or 30
    cancellationWindowHours: v.number(), // e.g., 24 hours
    emergencyBufferMinutesPerDay: v.number(),
    requireBookingApproval: v.optional(v.boolean()), // When true, online bookings enter pending_approval for front-desk review
    operatingHours: v.array(
      v.object({
        dayOfWeek: v.number(), // 0 (Sun) to 6 (Sat)
        isOpen: v.boolean(),
        openMinute: v.number(), // Minutes from midnight, e.g., 540 = 09:00
        closeMinute: v.number(), // e.g., 1020 = 17:00
      })
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_status", ["status"])
    .index("by_subscription_end", ["subscriptionEndsAt"])
    .index("by_plan", ["planId"]),

  subscriptionPayments: defineTable({
    clinicId: v.id("clinics"),
    planId: v.id("subscriptionPlans"),
    invoiceNumber: v.string(), // e.g., "INV-2026-00042"
    amountPhp: v.number(),
    billingCycle: v.union(v.literal("monthly"), v.literal("annual")),
    paymentMethod: v.union(
      v.literal("gcash"),
      v.literal("maya"),
      v.literal("bank_transfer"),
      v.literal("card"),
      v.literal("cash"),
      v.literal("manual_waiver")
    ),
    referenceNumber: v.optional(v.string()),
    receiptStorageId: v.optional(v.id("_storage")),
    periodStart: v.number(),
    periodEnd: v.number(),
    status: v.union(
      v.literal("paid"),
      v.literal("pending"),
      v.literal("overdue"),
      v.literal("refunded")
    ),
    notes: v.optional(v.string()),
    recordedByUserId: v.id("users"), // Super Admin ID
    paidAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_clinic", ["clinicId", "createdAt"])
    .index("by_status", ["status", "createdAt"])
    .index("by_paid_at", ["paidAt"]),

  platformMetricsDaily: defineTable({
    dateKey: v.string(), // "YYYY-MM-DD"
    totalClinics: v.number(),
    activePaidClinics: v.number(),
    trialClinics: v.number(),
    pastDueClinics: v.number(),
    suspendedClinics: v.number(),
    mrrPhp: v.number(), // Monthly Recurring Revenue in PHP
    arrPhp: v.number(), // Annual Run Rate in PHP
    revenueCollectedTodayPhp: v.number(),
    totalAppointmentsBooked: v.number(),
    completedAppointments: v.number(),
    cancelledAppointments: v.number(),
    noShowAppointments: v.number(),
    newPatientsRegistered: v.number(),
    totalStorageUsedBytes: v.number(),
    totalEmailsSentToday: v.number(),
    updatedAt: v.number(),
  }).index("by_date", ["dateKey"]),

  systemAnnouncements: defineTable({
    title: v.string(),
    message: v.string(),
    severity: v.union(v.literal("info"), v.literal("warning"), v.literal("critical")),
    targetAudience: v.union(
      v.literal("all_clinic_staff"),
      v.literal("clinic_admins_only"),
      v.literal("all_users")
    ),
    isActive: v.boolean(),
    expiresAt: v.optional(v.number()),
    createdByUserId: v.id("users"),
    createdAt: v.number(),
  }).index("by_active", ["isActive", "createdAt"]),

  platformAuditLogs: defineTable({
    actorUserId: v.id("users"),
    actorRole: v.string(),
    clinicId: v.optional(v.id("clinics")),
    actionType: v.string(), // e.g., "CLINIC_CREATED", "SUBSCRIPTION_RENEWED", "CLINIC_SUSPENDED"
    targetEntity: v.string(),
    targetId: v.string(),
    metadataJson: v.string(),
    createdAt: v.number(),
  })
    .index("by_created_at", ["createdAt"])
    .index("by_clinic_and_date", ["clinicId", "createdAt"])
    .index("by_actor", ["actorUserId", "createdAt"]),

  // ============================================================================
  // 2. USERS, STAFF INVITATIONS & MULTI-TENANT ACCESS
  // ============================================================================

  users: defineTable({
    clerkId: v.string(),
    email: v.string(),
    firstName: v.string(),
    lastName: v.string(),
    phone: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    role: v.union(
      v.literal("super_admin"),
      v.literal("clinic_admin"),
      v.literal("dentist"),
      v.literal("receptionist"),
      v.literal("patient")
    ),
    clinicId: v.optional(v.id("clinics")), // Populated for clinic_admin, dentist, receptionist
    isActive: v.boolean(),
    lastLoginAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_clerk_id", ["clerkId"])
    .index("by_email", ["email"])
    .index("by_clinic_and_role", ["clinicId", "role"])
    .index("by_role", ["role"]),

  staffInvitations: defineTable({
    clinicId: v.optional(v.id("clinics")), // Required for clinic_admin, dentist, receptionist; omitted for super_admin
    email: v.string(),
    role: v.union(
      v.literal("super_admin"),
      v.literal("clinic_admin"),
      v.literal("dentist"),
      v.literal("receptionist")
    ),
    token: v.optional(v.string()),
    inviterNote: v.optional(v.string()),
    invitedByUserId: v.id("users"),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("declined"),
      v.literal("revoked")
    ),
    declineReason: v.optional(v.string()),
    emailStatus: v.optional(
      v.union(
        v.literal("queued"),
        v.literal("sent"),
        v.literal("failed"),
        v.literal("skipped")
      )
    ),
    emailError: v.optional(v.string()),
    respondedAt: v.optional(v.number()),
    expiresAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_email_and_status", ["email", "status"])
    .index("by_clinic", ["clinicId", "status"])
    .index("by_token", ["token"])
    .index("by_status_and_created", ["status", "createdAt"]),

  // ============================================================================
  // 3. CLINIC RESOURCES (DENTISTS, CHAIRS, SERVICES)
  // ============================================================================

  dentists: defineTable({
    clinicId: v.id("clinics"),
    userId: v.id("users"),
    displayName: v.string(), // e.g., "Dr. Maria Santos, DMD"
    licenseNumber: v.string(),
    specialties: v.array(v.string()), // e.g., ["General Dentistry", "Orthodontics", "Endodontics"]
    bio: v.optional(v.string()),
    calendarColorHex: v.string(),
    defaultChairId: v.optional(v.id("chairs")),
    weeklySchedule: v.array(
      v.object({
        dayOfWeek: v.number(), // 0-6
        isWorking: v.boolean(),
        startMinute: v.number(),
        endMinute: v.number(),
        breakStartMinute: v.optional(v.number()),
        breakEndMinute: v.optional(v.number()),
      })
    ),
    isActive: v.boolean(),
  })
    .index("by_clinic", ["clinicId", "isActive"])
    .index("by_user", ["userId"]),

  dentistTimeOff: defineTable({
    clinicId: v.id("clinics"),
    dentistId: v.id("dentists"),
    startTimeUtc: v.number(),
    endTimeUtc: v.number(),
    reason: v.string(),
    createdByUserId: v.id("users"),
  })
    .index("by_clinic_and_time", ["clinicId", "startTimeUtc"])
    .index("by_dentist_and_time", ["dentistId", "startTimeUtc"]),

  chairs: defineTable({
    clinicId: v.id("clinics"),
    name: v.string(), // e.g., "Operatory Chair 1 (Surgical)"
    roomCode: v.string(),
    supportedCategoryTags: v.array(v.string()), // e.g., ["General", "Surgery", "X-Ray"]
    isActive: v.boolean(),
  }).index("by_clinic", ["clinicId", "isActive"]),

  services: defineTable({
    clinicId: v.id("clinics"),
    name: v.string(), // e.g., "Oral Prophylaxis (Cleaning)"
    category: v.union(
      v.literal("Preventive"),
      v.literal("Restorative"),
      v.literal("Cosmetic"),
      v.literal("Orthodontics"),
      v.literal("Endodontics"),
      v.literal("Oral Surgery"),
      v.literal("Emergency")
    ),
    description: v.string(),
    durationMinutes: v.number(), // e.g., 45
    bufferMinutes: v.number(), // Chair sterilization turnover, e.g., 15
    pricePhp: v.number(),
    requiresXray: v.boolean(),
    requiredChairTag: v.optional(v.string()),
    isActive: v.boolean(),
  }).index("by_clinic_and_category", ["clinicId", "category", "isActive"]),

  // ============================================================================
  // 4. PATIENTS, APPOINTMENTS, SLOT LOCKS & CLINICAL ODONTOGRAM
  // ============================================================================

  patients: defineTable({
    clinicId: v.id("clinics"),
    userId: v.optional(v.id("users")), // Optional so receptionists can add walk-in guests
    guardianPatientId: v.optional(v.id("patients")), // For child/dependent sub-profiles
    firstName: v.string(),
    lastName: v.string(),
    dateOfBirth: v.string(), // "YYYY-MM-DD"
    sex: v.union(v.literal("male"), v.literal("female"), v.literal("other")),
    email: v.optional(v.string()),
    phone: v.string(),
    address: v.optional(v.string()),
    emergencyContactName: v.optional(v.string()),
    emergencyContactPhone: v.optional(v.string()),

    // Structured Dental & Medical Intake Flags
    medicalHistory: v.object({
      allergies: v.array(v.string()), // e.g., ["Lidocaine", "Penicillin", "Latex"]
      conditions: v.array(v.string()), // e.g., ["Hypertension", "Diabetes"]
      isTakingBloodThinners: v.boolean(),
      isPregnant: v.boolean(),
      dentalAnxietyLevel: v.union(
        v.literal("none"),
        v.literal("mild"),
        v.literal("moderate"),
        v.literal("severe")
      ),
      notes: v.optional(v.string()),
    }),
    lastCleaningDate: v.optional(v.string()), // "YYYY-MM-DD" for 6-month hygiene recall
    nextRecallDate: v.optional(v.string()), // "YYYY-MM-DD"
    noShowCount: v.number(),
    createdAt: v.number(),
  })
    .index("by_clinic_and_user", ["clinicId", "userId"])
    .index("by_user", ["userId"])
    .index("by_clinic_and_phone", ["clinicId", "phone"])
    .index("by_clinic_and_recall", ["clinicId", "nextRecallDate"])
    .index("by_guardian", ["guardianPatientId"]),

  appointments: defineTable({
    clinicId: v.id("clinics"),
    patientId: v.id("patients"),
    dentistId: v.id("dentists"),
    chairId: v.id("chairs"),
    serviceId: v.id("services"),

    dateKey: v.string(), // "YYYY-MM-DD" in clinic local timezone
    startTimeUtc: v.number(), // Epoch ms
    endTimeUtc: v.number(), // Service duration end (Epoch ms)
    bufferEndTimeUtc: v.number(), // Includes sterilization buffer (used for conflict checks)

    status: v.union(
      v.literal("pending_approval"),
      v.literal("confirmed"),
      v.literal("checked_in"),
      v.literal("in_chair"),
      v.literal("completed"),
      v.literal("cancelled"),
      v.literal("no_show")
    ),
    bookingSource: v.union(
      v.literal("patient_online"),
      v.literal("front_desk_walk_in"),
      v.literal("front_desk_phone"),
      v.literal("dentist_followup"),
      v.literal("waitlist_claim")
    ),
    chiefComplaint: v.optional(v.string()),
    clinicalNotes: v.optional(v.string()),
    postVisitInstructions: v.optional(v.string()),
    reminder24hSent: v.boolean(),
    reminder2hSent: v.boolean(),
    cancellationReason: v.optional(v.string()),
    createdByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_clinic_and_date", ["clinicId", "dateKey"])
    .index("by_dentist_and_start", ["dentistId", "startTimeUtc"])
    .index("by_chair_and_start", ["chairId", "startTimeUtc"])
    .index("by_patient", ["patientId", "startTimeUtc"])
    .index("by_clinic_and_status", ["clinicId", "status", "startTimeUtc"]),

  slotLocks: defineTable({
    clinicId: v.id("clinics"),
    dentistId: v.id("dentists"),
    chairId: v.id("chairs"),
    startTimeUtc: v.number(),
    bufferEndTimeUtc: v.number(),
    lockedBySessionId: v.string(),
    expiresAtUtc: v.number(), // Current time + 5 minutes (300,000 ms)
  })
    .index("by_clinic_and_expires", ["clinicId", "expiresAtUtc"])
    .index("by_dentist_and_start", ["dentistId", "startTimeUtc"])
    .index("by_chair_and_start", ["chairId", "startTimeUtc"])
    .index("by_expires", ["expiresAtUtc"]),

  toothRecords: defineTable({
    clinicId: v.id("clinics"),
    patientId: v.id("patients"),
    toothNumber: v.number(), // Universal Numbering System 1-32 (or 51-85 for pediatric)
    surface: v.optional(
      v.union(
        v.literal("Mesial"),
        v.literal("Distal"),
        v.literal("Occlusal"),
        v.literal("Buccal"),
        v.literal("Lingual"),
        v.literal("WholeTooth")
      )
    ),
    condition: v.union(
      v.literal("sound"),
      v.literal("caries"),
      v.literal("composite_filling"),
      v.literal("amalgam_filling"),
      v.literal("crown"),
      v.literal("root_canal"),
      v.literal("extraction_needed"),
      v.literal("missing"),
      v.literal("implant")
    ),
    treatmentStatus: v.union(
      v.literal("existing"),
      v.literal("planned"),
      v.literal("completed")
    ),
    notes: v.optional(v.string()),
    appointmentId: v.optional(v.id("appointments")),
    recordedByDentistId: v.id("dentists"),
    updatedAt: v.number(),
  })
    .index("by_clinic_and_patient_tooth", ["clinicId", "patientId", "toothNumber"])
    .index("by_patient_and_tooth", ["patientId", "toothNumber"]),

  clinicalFiles: defineTable({
    clinicId: v.id("clinics"),
    patientId: v.id("patients"),
    appointmentId: v.optional(v.id("appointments")),
    storageId: v.id("_storage"),
    fileName: v.string(),
    fileType: v.union(
      v.literal("xray_periapical"),
      v.literal("xray_panoramic"),
      v.literal("intraoral_photo"),
      v.literal("consent_form")
    ),
    sizeBytes: v.number(),
    uploadedByUserId: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_clinic_and_patient", ["clinicId", "patientId", "createdAt"])
    .index("by_patient", ["patientId", "createdAt"]),

  waitlist: defineTable({
    clinicId: v.id("clinics"),
    patientId: v.id("patients"),
    serviceId: v.id("services"),
    preferredDentistId: v.optional(v.id("dentists")),
    preferredDateKey: v.string(), // "YYYY-MM-DD"
    preferredTimeWindow: v.union(
      v.literal("morning"),
      v.literal("afternoon"),
      v.literal("any")
    ),
    status: v.union(
      v.literal("waiting"),
      v.literal("notified"),
      v.literal("claimed"),
      v.literal("expired")
    ),
    createdAt: v.number(),
  })
    .index("by_clinic_and_date", ["clinicId", "preferredDateKey", "status"])
    .index("by_patient", ["patientId", "createdAt"])
    .index("by_status_and_date", ["status", "preferredDateKey"]),

  clinicMetricsDaily: defineTable({
    clinicId: v.id("clinics"),
    dateKey: v.string(), // "YYYY-MM-DD"
    totalBooked: v.number(),
    completedCount: v.number(),
    cancelledCount: v.number(),
    noShowCount: v.number(),
    estimatedRevenuePhp: v.number(),
    newPatientsCount: v.number(),
  }).index("by_clinic_and_date", ["clinicId", "dateKey"]),
});


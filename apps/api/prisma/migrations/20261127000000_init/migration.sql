-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SubscriptionPlanCode" AS ENUM ('trial', 'starter', 'pro', 'enterprise');

-- CreateEnum
CREATE TYPE "ClinicStatus" AS ENUM ('trial', 'active', 'past_due', 'suspended', 'archived');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('monthly', 'annual', 'trial');

-- CreateEnum
CREATE TYPE "PaymentBillingCycle" AS ENUM ('monthly', 'annual');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('gcash', 'maya', 'bank_transfer', 'card', 'cash', 'manual_waiver');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('paid', 'pending', 'overdue', 'refunded');

-- CreateEnum
CREATE TYPE "AnnouncementSeverity" AS ENUM ('info', 'warning', 'critical');

-- CreateEnum
CREATE TYPE "AnnouncementAudience" AS ENUM ('all_clinic_staff', 'clinic_admins_only', 'all_users');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('super_admin', 'clinic_admin', 'dentist', 'receptionist', 'patient');

-- CreateEnum
CREATE TYPE "StaffInvitationRole" AS ENUM ('super_admin', 'clinic_admin', 'dentist', 'receptionist');

-- CreateEnum
CREATE TYPE "StaffInvitationStatus" AS ENUM ('pending', 'accepted', 'declined', 'revoked');

-- CreateEnum
CREATE TYPE "EmailDeliveryStatus" AS ENUM ('queued', 'sent', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "ServiceCategory" AS ENUM ('Preventive', 'Restorative', 'Cosmetic', 'Orthodontics', 'Endodontics', 'Oral Surgery', 'Emergency');

-- CreateEnum
CREATE TYPE "PatientSex" AS ENUM ('male', 'female', 'other');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('pending_approval', 'confirmed', 'checked_in', 'in_chair', 'completed', 'cancelled', 'no_show');

-- CreateEnum
CREATE TYPE "BookingSource" AS ENUM ('patient_online', 'front_desk_walk_in', 'front_desk_phone', 'dentist_followup', 'waitlist_claim');

-- CreateEnum
CREATE TYPE "ToothSurface" AS ENUM ('Mesial', 'Distal', 'Occlusal', 'Buccal', 'Lingual', 'WholeTooth');

-- CreateEnum
CREATE TYPE "ToothCondition" AS ENUM ('sound', 'caries', 'composite_filling', 'amalgam_filling', 'crown', 'root_canal', 'extraction_needed', 'missing', 'implant');

-- CreateEnum
CREATE TYPE "TreatmentStatus" AS ENUM ('existing', 'planned', 'completed');

-- CreateEnum
CREATE TYPE "ClinicalFileType" AS ENUM ('xray_periapical', 'xray_panoramic', 'intraoral_photo', 'consent_form');

-- CreateEnum
CREATE TYPE "TimeWindow" AS ENUM ('morning', 'afternoon', 'any');

-- CreateEnum
CREATE TYPE "WaitlistStatus" AS ENUM ('waiting', 'notified', 'claimed', 'expired');

-- CreateTable
CREATE TABLE "subscription_plans" (
    "id" UUID NOT NULL,
    "code" "SubscriptionPlanCode" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "monthly_price_php" INTEGER NOT NULL,
    "annual_price_php" INTEGER NOT NULL,
    "trial_days" INTEGER NOT NULL,
    "max_dentists" INTEGER NOT NULL,
    "max_chairs" INTEGER NOT NULL,
    "max_appointments_per_month" INTEGER NOT NULL,
    "max_storage_bytes" BIGINT NOT NULL,
    "max_emails_per_month" INTEGER NOT NULL,
    "default_features" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinics" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "tagline" TEXT,
    "logo_storage_key" TEXT,
    "primary_color_hex" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Manila',
    "owner_user_id" UUID,
    "plan_id" UUID NOT NULL,
    "status" "ClinicStatus" NOT NULL,
    "billing_cycle" "BillingCycle" NOT NULL,
    "trial_ends_at" TIMESTAMPTZ(3),
    "subscription_starts_at" TIMESTAMPTZ(3) NOT NULL,
    "subscription_ends_at" TIMESTAMPTZ(3) NOT NULL,
    "grace_period_ends_at" TIMESTAMPTZ(3),
    "feature_flags" JSONB NOT NULL,
    "active_dentist_count" INTEGER NOT NULL DEFAULT 0,
    "active_chair_count" INTEGER NOT NULL DEFAULT 0,
    "current_month_key" TEXT NOT NULL,
    "current_month_appointment_count" INTEGER NOT NULL DEFAULT 0,
    "current_month_email_count" INTEGER NOT NULL DEFAULT 0,
    "storage_used_bytes" BIGINT NOT NULL DEFAULT 0,
    "lifetime_appointment_count" INTEGER NOT NULL DEFAULT 0,
    "slot_interval_minutes" INTEGER NOT NULL DEFAULT 30,
    "cancellation_window_hours" INTEGER NOT NULL DEFAULT 24,
    "emergency_buffer_minutes_per_day" INTEGER NOT NULL DEFAULT 0,
    "require_booking_approval" BOOLEAN NOT NULL DEFAULT false,
    "operating_hours" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "clinics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_payments" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "amount_php" INTEGER NOT NULL,
    "billing_cycle" "PaymentBillingCycle" NOT NULL,
    "payment_method" "PaymentMethod" NOT NULL,
    "reference_number" TEXT,
    "receipt_storage_key" TEXT,
    "period_start" TIMESTAMPTZ(3) NOT NULL,
    "period_end" TIMESTAMPTZ(3) NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "notes" TEXT,
    "recorded_by_user_id" UUID NOT NULL,
    "paid_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_metrics_daily" (
    "id" UUID NOT NULL,
    "date_key" TEXT NOT NULL,
    "total_clinics" INTEGER NOT NULL,
    "active_paid_clinics" INTEGER NOT NULL,
    "trial_clinics" INTEGER NOT NULL,
    "past_due_clinics" INTEGER NOT NULL,
    "suspended_clinics" INTEGER NOT NULL,
    "mrr_php" INTEGER NOT NULL,
    "arr_php" INTEGER NOT NULL,
    "revenue_collected_today_php" INTEGER NOT NULL,
    "total_appointments_booked" INTEGER NOT NULL,
    "completed_appointments" INTEGER NOT NULL,
    "cancelled_appointments" INTEGER NOT NULL,
    "no_show_appointments" INTEGER NOT NULL,
    "new_patients_registered" INTEGER NOT NULL,
    "total_storage_used_bytes" BIGINT NOT NULL,
    "total_emails_sent_today" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_metrics_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_announcements" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "severity" "AnnouncementSeverity" NOT NULL,
    "target_audience" "AnnouncementAudience" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_audit_logs" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "actor_role" TEXT NOT NULL,
    "clinic_id" UUID,
    "action_type" TEXT NOT NULL,
    "target_entity" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "metadata_json" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "clerk_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "phone" TEXT,
    "avatar_url" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'patient',
    "clinic_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_invitations" (
    "id" UUID NOT NULL,
    "clinic_id" UUID,
    "email" TEXT NOT NULL,
    "role" "StaffInvitationRole" NOT NULL,
    "token" TEXT,
    "inviter_note" TEXT,
    "invited_by_user_id" UUID NOT NULL,
    "status" "StaffInvitationStatus" NOT NULL DEFAULT 'pending',
    "decline_reason" TEXT,
    "email_status" "EmailDeliveryStatus",
    "email_error" TEXT,
    "responded_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dentists" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "license_number" TEXT NOT NULL,
    "specialties" TEXT[],
    "bio" TEXT,
    "calendar_color_hex" TEXT NOT NULL,
    "default_chair_id" UUID,
    "weekly_schedule" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "dentists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dentist_time_off" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "dentist_id" UUID NOT NULL,
    "start_time_utc" TIMESTAMPTZ(3) NOT NULL,
    "end_time_utc" TIMESTAMPTZ(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by_user_id" UUID NOT NULL,

    CONSTRAINT "dentist_time_off_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chairs" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "room_code" TEXT NOT NULL,
    "supported_category_tags" TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "chairs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" "ServiceCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "buffer_minutes" INTEGER NOT NULL,
    "price_php" INTEGER NOT NULL,
    "requires_xray" BOOLEAN NOT NULL DEFAULT false,
    "required_chair_tag" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patients" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "user_id" UUID,
    "guardian_patient_id" UUID,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "date_of_birth" TEXT NOT NULL,
    "sex" "PatientSex" NOT NULL,
    "email" TEXT,
    "phone" TEXT NOT NULL,
    "address" TEXT,
    "emergency_contact_name" TEXT,
    "emergency_contact_phone" TEXT,
    "medical_history" JSONB NOT NULL,
    "last_cleaning_date" TEXT,
    "next_recall_date" TEXT,
    "no_show_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "dentist_id" UUID NOT NULL,
    "chair_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "date_key" TEXT NOT NULL,
    "start_time_utc" TIMESTAMPTZ(3) NOT NULL,
    "end_time_utc" TIMESTAMPTZ(3) NOT NULL,
    "buffer_end_time_utc" TIMESTAMPTZ(3) NOT NULL,
    "status" "AppointmentStatus" NOT NULL,
    "booking_source" "BookingSource" NOT NULL,
    "chief_complaint" TEXT,
    "clinical_notes" TEXT,
    "post_visit_instructions" TEXT,
    "reminder_24h_sent" BOOLEAN NOT NULL DEFAULT false,
    "reminder_2h_sent" BOOLEAN NOT NULL DEFAULT false,
    "cancellation_reason" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tooth_records" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "tooth_number" INTEGER NOT NULL,
    "surface" "ToothSurface",
    "condition" "ToothCondition" NOT NULL,
    "treatment_status" "TreatmentStatus" NOT NULL,
    "notes" TEXT,
    "appointment_id" UUID,
    "recorded_by_dentist_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tooth_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical_files" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "appointment_id" UUID,
    "storage_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_type" "ClinicalFileType" NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "uploaded_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinical_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waitlist" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "preferred_dentist_id" UUID,
    "preferred_date_key" TEXT NOT NULL,
    "preferred_time_window" "TimeWindow" NOT NULL,
    "status" "WaitlistStatus" NOT NULL DEFAULT 'waiting',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waitlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_metrics_daily" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "date_key" TEXT NOT NULL,
    "total_booked" INTEGER NOT NULL DEFAULT 0,
    "completed_count" INTEGER NOT NULL DEFAULT 0,
    "cancelled_count" INTEGER NOT NULL DEFAULT 0,
    "no_show_count" INTEGER NOT NULL DEFAULT 0,
    "estimated_revenue_php" INTEGER NOT NULL DEFAULT 0,
    "new_patients_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "clinic_metrics_daily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscription_plans_code_key" ON "subscription_plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "clinics_slug_key" ON "clinics"("slug");

-- CreateIndex
CREATE INDEX "clinics_status_idx" ON "clinics"("status");

-- CreateIndex
CREATE INDEX "clinics_subscription_end_idx" ON "clinics"("subscription_ends_at");

-- CreateIndex
CREATE INDEX "clinics_plan_idx" ON "clinics"("plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_payments_invoice_number_key" ON "subscription_payments"("invoice_number");

-- CreateIndex
CREATE INDEX "subscription_payments_clinic_created_idx" ON "subscription_payments"("clinic_id", "created_at");

-- CreateIndex
CREATE INDEX "subscription_payments_status_created_idx" ON "subscription_payments"("status", "created_at");

-- CreateIndex
CREATE INDEX "subscription_payments_paid_at_idx" ON "subscription_payments"("paid_at");

-- CreateIndex
CREATE UNIQUE INDEX "platform_metrics_daily_date_key_key" ON "platform_metrics_daily"("date_key");

-- CreateIndex
CREATE INDEX "system_announcements_active_created_idx" ON "system_announcements"("is_active", "created_at");

-- CreateIndex
CREATE INDEX "platform_audit_logs_created_at_idx" ON "platform_audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "platform_audit_logs_clinic_created_idx" ON "platform_audit_logs"("clinic_id", "created_at");

-- CreateIndex
CREATE INDEX "platform_audit_logs_actor_created_idx" ON "platform_audit_logs"("actor_user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "users_clerk_id_key" ON "users"("clerk_id");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_clinic_role_idx" ON "users"("clinic_id", "role");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE UNIQUE INDEX "staff_invitations_token_key" ON "staff_invitations"("token");

-- CreateIndex
CREATE INDEX "staff_invitations_email_status_idx" ON "staff_invitations"("email", "status");

-- CreateIndex
CREATE INDEX "staff_invitations_clinic_status_idx" ON "staff_invitations"("clinic_id", "status");

-- CreateIndex
CREATE INDEX "staff_invitations_status_created_idx" ON "staff_invitations"("status", "created_at");

-- CreateIndex
CREATE INDEX "dentists_clinic_active_idx" ON "dentists"("clinic_id", "is_active");

-- CreateIndex
CREATE INDEX "dentists_user_idx" ON "dentists"("user_id");

-- CreateIndex
CREATE INDEX "dentist_time_off_clinic_start_idx" ON "dentist_time_off"("clinic_id", "start_time_utc");

-- CreateIndex
CREATE INDEX "dentist_time_off_dentist_start_idx" ON "dentist_time_off"("dentist_id", "start_time_utc");

-- CreateIndex
CREATE INDEX "chairs_clinic_active_idx" ON "chairs"("clinic_id", "is_active");

-- CreateIndex
CREATE INDEX "services_clinic_category_active_idx" ON "services"("clinic_id", "category", "is_active");

-- CreateIndex
CREATE INDEX "patients_clinic_user_idx" ON "patients"("clinic_id", "user_id");

-- CreateIndex
CREATE INDEX "patients_user_idx" ON "patients"("user_id");

-- CreateIndex
CREATE INDEX "patients_clinic_phone_idx" ON "patients"("clinic_id", "phone");

-- CreateIndex
CREATE INDEX "patients_clinic_recall_idx" ON "patients"("clinic_id", "next_recall_date");

-- CreateIndex
CREATE INDEX "patients_guardian_idx" ON "patients"("guardian_patient_id");

-- CreateIndex
CREATE INDEX "appointments_clinic_date_idx" ON "appointments"("clinic_id", "date_key");

-- CreateIndex
CREATE INDEX "appointments_dentist_start_idx" ON "appointments"("dentist_id", "start_time_utc");

-- CreateIndex
CREATE INDEX "appointments_chair_start_idx" ON "appointments"("chair_id", "start_time_utc");

-- CreateIndex
CREATE INDEX "appointments_patient_start_idx" ON "appointments"("patient_id", "start_time_utc");

-- CreateIndex
CREATE INDEX "appointments_clinic_status_start_idx" ON "appointments"("clinic_id", "status", "start_time_utc");

-- CreateIndex
CREATE INDEX "tooth_records_clinic_patient_tooth_idx" ON "tooth_records"("clinic_id", "patient_id", "tooth_number");

-- CreateIndex
CREATE INDEX "tooth_records_patient_tooth_idx" ON "tooth_records"("patient_id", "tooth_number");

-- CreateIndex
CREATE INDEX "clinical_files_clinic_patient_created_idx" ON "clinical_files"("clinic_id", "patient_id", "created_at");

-- CreateIndex
CREATE INDEX "clinical_files_patient_created_idx" ON "clinical_files"("patient_id", "created_at");

-- CreateIndex
CREATE INDEX "waitlist_clinic_date_status_idx" ON "waitlist"("clinic_id", "preferred_date_key", "status");

-- CreateIndex
CREATE INDEX "waitlist_patient_created_idx" ON "waitlist"("patient_id", "created_at");

-- CreateIndex
CREATE INDEX "waitlist_status_date_idx" ON "waitlist"("status", "preferred_date_key");

-- CreateIndex
CREATE UNIQUE INDEX "clinic_metrics_daily_clinic_date_uq" ON "clinic_metrics_daily"("clinic_id", "date_key");

-- AddForeignKey
ALTER TABLE "clinics" ADD CONSTRAINT "clinics_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinics" ADD CONSTRAINT "clinics_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_announcements" ADD CONSTRAINT "system_announcements_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_audit_logs" ADD CONSTRAINT "platform_audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_audit_logs" ADD CONSTRAINT "platform_audit_logs_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dentists" ADD CONSTRAINT "dentists_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dentists" ADD CONSTRAINT "dentists_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dentists" ADD CONSTRAINT "dentists_default_chair_id_fkey" FOREIGN KEY ("default_chair_id") REFERENCES "chairs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dentist_time_off" ADD CONSTRAINT "dentist_time_off_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dentist_time_off" ADD CONSTRAINT "dentist_time_off_dentist_id_fkey" FOREIGN KEY ("dentist_id") REFERENCES "dentists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dentist_time_off" ADD CONSTRAINT "dentist_time_off_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chairs" ADD CONSTRAINT "chairs_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_guardian_patient_id_fkey" FOREIGN KEY ("guardian_patient_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_dentist_id_fkey" FOREIGN KEY ("dentist_id") REFERENCES "dentists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_chair_id_fkey" FOREIGN KEY ("chair_id") REFERENCES "chairs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tooth_records" ADD CONSTRAINT "tooth_records_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tooth_records" ADD CONSTRAINT "tooth_records_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tooth_records" ADD CONSTRAINT "tooth_records_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tooth_records" ADD CONSTRAINT "tooth_records_recorded_by_dentist_id_fkey" FOREIGN KEY ("recorded_by_dentist_id") REFERENCES "dentists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_files" ADD CONSTRAINT "clinical_files_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_files" ADD CONSTRAINT "clinical_files_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_files" ADD CONSTRAINT "clinical_files_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_files" ADD CONSTRAINT "clinical_files_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_preferred_dentist_id_fkey" FOREIGN KEY ("preferred_dentist_id") REFERENCES "dentists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_metrics_daily" ADD CONSTRAINT "clinic_metrics_daily_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ============================================================================
-- Smile Concurrency Invariant (Law #5): Database-Level Double-Booking Immunity
-- Prevents overlapping active appointment intervals [start_time_utc, buffer_end_time_utc)
-- for the same dentist or operatory chair even under concurrent writes.
-- Maps Postgres exclusion violation error code 23P01 -> HTTP 409 Conflict.
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_valid_interval_chk"
  CHECK ("start_time_utc" < "end_time_utc" AND "end_time_utc" <= "buffer_end_time_utc");

ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_no_dentist_overlap_excl"
  EXCLUDE USING gist (
    "dentist_id" WITH =,
    tstzrange("start_time_utc", "buffer_end_time_utc", '[)') WITH &&
  )
  WHERE ("status" NOT IN ('cancelled', 'no_show'));

ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_no_chair_overlap_excl"
  EXCLUDE USING gist (
    "chair_id" WITH =,
    tstzrange("start_time_utc", "buffer_end_time_utc", '[)') WITH &&
  )
  WHERE ("status" NOT IN ('cancelled', 'no_show'));

# CLINIC_SCHEDULING_SPEC.md — Smart Scheduling Engine, Clinical Charting & Patient Portal Specification

## 1. Dual-Resource Dental Scheduling Engine (`convex/availability.ts`)

Unlike generic calendar apps that only check a person's availability, a dental clinic requires **two physical resources simultaneously** for every procedure: an available **Dentist** and an available **Operatory Dental Chair** equipped for that procedure category, plus **chair sterilization turnover time** (`bufferMinutes`).

### 1.1 Slot Calculation Algorithm (`availability:getAvailableSlots`)

When a patient or receptionist selects `(clinicId, serviceId, dateKey, optionalPreferredDentistId)`:

1. **Validate Clinic & Operating Hours**:
   * Load the `clinics` record via `clinicId`. Verify `status` is `"active"`, `"trial"`, or `"past_due"` (reject if `"suspended"` or `"archived"`).
   * Look up `operatingHours` for the target date's `dayOfWeek` (`0–6`). If `isOpen === false`, return `[]`.
2. **Load Target Service Requirements**:
   * Fetch `services` record (`durationMinutes`, `bufferMinutes`, `requiredChairTag`).
   * Compute `totalBlockMinutes = durationMinutes + bufferMinutes`.
3. **Resolve Eligible Dentists & Eligible Chairs**:
   * Query active `dentists` in `clinicId` (filtered to `preferredDentistId` if specified) whose `weeklySchedule` marks that `dayOfWeek` as `isWorking === true`.
   * Query active `chairs` in `clinicId` whose `supportedCategoryTags` includes `service.requiredChairTag` (or all active chairs if `requiredChairTag` is undefined).
4. **Fetch Existing Commitments in Parallel**:
   * Query `appointments` via `.withIndex("by_clinic_and_date", q => q.eq("clinicId", clinicId).eq("dateKey", dateKey))` where `status` is not `"cancelled"`.
   * Query active `slotLocks` for that clinic where `expiresAtUtc > Date.now()`.
   * Query `dentistTimeOff` overlapping that date.
5. **Step Through Candidate Intervals**:
   * Iterate `candidateMinute` from `clinicOpenMinute` to `clinicCloseMinute - durationMinutes` in increments of `clinic.slotIntervalMinutes` (e.g., every 15 or 30 minutes).
   * Convert `[candidateMinute, candidateMinute + totalBlockMinutes]` to UTC epoch milliseconds `[slotStartUtc, slotBufferEndUtc]`.
   * A candidate slot is **Available** if and only if there exists **at least one eligible Dentist** (`D`) and **at least one eligible Chair** (`C`) such that:
     * `slotStartUtc` and `slotStartUtc + durationMinutes` fall inside Dentist `D`'s working hours and outside `D`'s lunch break (`breakStartMinute` to `breakEndMinute`) and `dentistTimeOff`.
     * Dentist `D` has **zero** overlapping appointments or active `slotLocks` where `existing.startTimeUtc < slotBufferEndUtc && existing.bufferEndTimeUtc > slotStartUtc`.
     * Chair `C` has **zero** overlapping appointments or active `slotLocks` where `existing.startTimeUtc < slotBufferEndUtc && existing.bufferEndTimeUtc > slotStartUtc`.
6. **Return Assigned Resource Pair**:
   * Return each valid slot with its candidate `startTimeUtc`, `endTimeUtc`, assigned `dentistId` (preferring the dentist's `defaultChairId` when free), and `chairId`.

### 1.2 Real-Time 5-Minute Slot Locking (`convex/slotLocks.ts`)

To prevent two patients from colliding while filling out medical history forms:
1. When a patient clicks a time slot in Step 2 of the booking wizard, call `slotLocks:acquireLock` which runs an ACID check ([Convex vs SQL](https://www.convex.dev/compare/sql)) and inserts a `slotLocks` document with `expiresAtUtc = Date.now() + 300_000` (5 minutes).
2. Schedule an automatic cleanup call via `ctx.scheduler.runAfter(300_000, internal.slotLocks.releaseLock, { lockId })` ([Convex Scheduled Functions](https://docs.convex.dev/scheduling/scheduled-functions)).
3. Display a live 5:00 countdown timer in the patient booking UI. When the patient submits Step 4 (`appointments:createOnlineBooking`), delete the `slotLocks` document and insert the `appointments` document in the same transaction.

## 2. Public Clinic Portal & 4-Step Patient Booking Wizard (`/c/[clinicSlug]`)

Each active clinic gets a branded public landing and booking portal at `/c/[clinicSlug]`:

* **Step 1 — Select Dental Procedure**: Categorized cards (`Preventive`, `Restorative`, `Cosmetic`, `Orthodontics`, `Oral Surgery`, `Emergency`) showing procedure description, duration (`e.g., 45 mins`), and transparent base price in `PHP`.
* **Step 2 — Choose Dentist & Time Slot**: Option to pick a specific doctor (showing specialty badges) or **"First Available Dentist"**, paired with an interactive date picker and real-time slot grid. Selecting a slot acquires a 5-minute `slotLocks` hold.
* **Step 3 — Patient Profile & Family Dependent Selector**:
  * Authenticated patients ([Clerk](https://clerk.com/)) can book for **Myself** or select/add a **Family Dependent** (child or senior parent linked via `guardianPatientId`).
  * Collects structured dental & medical intake flags: Allergies (`Lidocaine`, `Penicillin`, `Latex`, `NSAIDs`), Medical Conditions (`Hypertension`, `Diabetes`, `Heart Disease`), Blood Thinner use, Pregnancy status, Dental Anxiety Level (`None` to `Severe`), and Chief Complaint.
* **Step 4 — Instant Confirmation & Calendar Export**:
  * Displays booking reference code, dentist and chair assignment, clinic map/address, cancellation policy (`24 hours notice`), and an **"Add to Google Calendar / Download .ICS"** button, while firing a confirmation email via [Resend](https://resend.com/pricing).

## 3. Receptionist Front-Desk Command Center (`/front-desk`)

Built for high-speed keyboard and mouse operation at the clinic reception desk:

1. **Multi-Chair & Multi-Dentist Master Calendar**:
   * Powered by [Shadcn Big Calendar](https://github.com/list-jonas/shadcn-ui-big-calendar) with Day (grouped by Operatory Chair or Dentist), Week, and Agenda views.
   * Color-codes appointments by dentist (`dentists.calendarColorHex`) with status badges (`Confirmed`, `Checked In`, `In Chair`, `Completed`, `No-Show`).
2. **Live Patient Flow Kanban Board**:
   * Drag-and-drop or one-click status transitions across four live columns:
     * **Scheduled Today** → **Checked In (Waiting Room)** → **In Chair (Treatment Active)** → **Completed / Checkout**.
   * Moving a card to **In Chair** immediately flashes a real-time notification on the assigned Dentist's `/staff` screen via [Convex](https://www.convex.dev/pricing).
3. **Walk-In & Phone Quick-Book Modal**:
   * Allows receptionists to search existing patients by phone/name or create a walk-in patient profile without requiring the patient to have a Clerk account (`patients.userId` is optional).
4. **Standby Waitlist & Cancellation Blast**:
   * When an appointment is cancelled, `appointments:cancel` checks the `waitlist` table for matching `clinicId` and `preferredDateKey`. If matches exist and `featureFlags.waitlistAutomationEnabled` is true, it triggers an email notification to waitlisted patients with a one-click claim link.

## 4. Dentist Clinical Workspace & 32-Tooth SVG Odontogram (`/staff`)

Designed for dentists and hygienists operating chairside on tablets or desktops:

1. **My Chair Schedule & Patient Medical Alert Banner**:
   * Displays the dentist's daily queue. If a patient has critical medical flags (`allergies.length > 0`, `isTakingBloodThinners === true`, `isPregnant === true`, or `dentalAnxietyLevel === "severe"`), renders a high-contrast crimson medical alert badge at the top of the clinical chart.
2. **Interactive 32-Tooth SVG Odontogram (`src/components/clinical/Odontogram.tsx`)**:
   * Renders the full adult arch (Teeth `1–16` Upper Arch, `17–32` Lower Arch) with 5 clickable geometric surfaces per tooth (`Mesial`, `Distal`, `Occlusal`, `Buccal`, `Lingual`).
   * Clicking a tooth or surface opens a popover to record its condition (`Sound`, `Caries / Decay` in red, `Composite Filling` in blue, `Crown` in gold, `Root Canal` in purple, `Extraction Needed` in cross-hatch, `Missing` dimmed) and status (`Existing`, `Planned`, `Completed`).
   * Every update writes to `toothRecords` and appends a timestamped entry to the patient's clinical history.
3. **Compressed X-Ray & Intraoral Photo Vault (`convex/files.ts`)**:
   * Dentists upload periapical/panoramic X-rays and before/after photos using [Convex File Storage](https://docs.convex.dev/file-storage/overview).
   * Enforces client-side HTML5 Canvas image compression (`max 1600px width, 0.8 WebP quality, <= 500 KB`) before upload so a clinic can store over 2,000 X-rays within the 1 GB free tier ([Convex Limits](https://docs.convex.dev/production/state/limits)).
4. **One-Click 6-Month Hygiene Recall Scheduling**:
   * When marking an Oral Prophylaxis appointment `Completed`, automatically sets `patients.lastCleaningDate = today` and `patients.nextRecallDate = today + 6 months` so the daily recall cron job invites the patient back automatically.

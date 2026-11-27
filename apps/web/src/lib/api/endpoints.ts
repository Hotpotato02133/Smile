import type {
  PatientClinicalSummary,
  PatientDashboardData,
} from "@/components/patient/types";
import type {
  AnyRecord,
  AuditLogItem,
  AvailableSlot,
  AvailableSlotsResult,
  ChairDoc,
  ClinicDailyMetricsResult,
  ClinicDetailData,
  ClinicDoc,
  DentistDoc,
  DentistQueueData,
  DentistTimeOffResult,
  DentistsListResult,
  FreeTierUsageData,
  FrontDeskWorkspaceData,
  InvitationPublicDetails,
  MyClinicProfilesResult,
  PatientChartData,
  PatientDoc,
  PaymentDoc,
  PlatformDashboardOverviewData,
  PlatformUsersListResult,
  PublicClinicPortal,
  PublicClinicSummary,
  ServiceDoc,
  StaffInvitationDoc,
  SubscriptionPlanDoc,
  SystemAnnouncementDoc,
  TimeOffConflictsResult,
  UserDoc,
} from "./models";
import type { ApiEndpoint, HttpMethod } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyArgs = Record<string, any>;

function queryEndpoint<TResult = AnyRecord>(
  key: string,
  buildPath: (args: AnyArgs) => string,
  options?: {
    isPublic?: boolean;
    buildQuery?: (
      args: AnyArgs
    ) => Record<string, string | number | boolean | undefined>;
    transform?: (raw: unknown) => TResult;
  }
): ApiEndpoint<AnyArgs, TResult> {
  return {
    kind: "query",
    key,
    method: "GET",
    isPublic: options?.isPublic,
    buildPath,
    buildQuery: options?.buildQuery,
    transform: options?.transform,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mutationEndpoint<TResult = any>(
  key: string,
  method: HttpMethod | ((args: AnyArgs) => HttpMethod),
  buildPath: (args: AnyArgs) => string,
  options?: {
    isPublic?: boolean;
    invalidates?: readonly string[];
    buildQuery?: (
      args: AnyArgs
    ) => Record<string, string | number | boolean | undefined>;
    buildBody?: (args: AnyArgs) => unknown;
    transform?: (raw: unknown) => TResult;
  }
): ApiEndpoint<AnyArgs, TResult> {
  return {
    kind: "mutation",
    key,
    method,
    isPublic: options?.isPublic,
    invalidates: options?.invalidates,
    buildPath,
    buildQuery: options?.buildQuery,
    buildBody: options?.buildBody ?? ((args) => args),
    transform: options?.transform,
  };
}

const overrideQuery = (args: AnyArgs) => ({
  overrideClinicId: args?.overrideClinicId as string | undefined,
});

function normalizeAuditLog(item: AnyRecord): AuditLogItem {
  const actor = item.actorUser as AnyRecord | undefined;
  return {
    ...item,
    actorName:
      item.actorName ??
      (actor ? `${actor.firstName ?? ""} ${actor.lastName ?? ""}`.trim() : "System"),
    actorEmail: item.actorEmail ?? actor?.email ?? "",
    clinicName: item.clinicName ?? item.clinic?.name ?? null,
  } as AuditLogItem;
}

export const api = {
  users: {
    current: queryEndpoint<UserDoc | null>("users.current", () => "/api/v1/users/me"),
    ensureCurrentUser: mutationEndpoint(
      "users.ensure",
      "POST",
      () => "/api/v1/users/ensure",
      { invalidates: ["users", "clinicAdmin", "superAdmin", "patientPortal"] }
    ),
  },

  superAdmin: {
    listClinics: queryEndpoint<Array<ClinicDoc & AnyRecord>>(
      "superAdmin.clinics",
      () => "/api/v1/super-admin/clinics",
      {
        buildQuery: (a) => ({
          status: a?.status,
          planId: a?.planId,
          search: a?.search,
        }),
      }
    ),
    getClinicDetail: queryEndpoint<ClinicDetailData>(
      "superAdmin.clinicDetail",
      (a) => `/api/v1/super-admin/clinics/${a.clinicId}`
    ),
    createClinic: mutationEndpoint(
      "superAdmin.createClinic",
      "POST",
      () => "/api/v1/super-admin/clinics",
      { invalidates: ["superAdmin", "platformAnalytics"] }
    ),
    updateClinicDetails: mutationEndpoint(
      "superAdmin.updateClinicDetails",
      "PATCH",
      (a) => `/api/v1/super-admin/clinics/${a.clinicId}/details`,
      { invalidates: ["superAdmin", "clinicAdmin"] }
    ),
    updateClinicStatus: mutationEndpoint(
      "superAdmin.updateClinicStatus",
      "PATCH",
      (a) => `/api/v1/super-admin/clinics/${a.clinicId}/status`,
      { invalidates: ["superAdmin", "platformAnalytics", "clinicAdmin"] }
    ),
    changeClinicPlan: mutationEndpoint(
      "superAdmin.changeClinicPlan",
      "PATCH",
      (a) => `/api/v1/super-admin/clinics/${a.clinicId}/plan`,
      { invalidates: ["superAdmin", "platformAnalytics", "clinicAdmin"] }
    ),
    updateClinicFeatures: mutationEndpoint(
      "superAdmin.updateClinicFeatures",
      "PATCH",
      (a) => `/api/v1/super-admin/clinics/${a.clinicId}/features`,
      { invalidates: ["superAdmin", "clinicAdmin"] }
    ),
    extendClinicSubscription: mutationEndpoint(
      "superAdmin.extendSubscription",
      "POST",
      (a) => `/api/v1/super-admin/clinics/${a.clinicId}/extend`,
      {
        invalidates: ["superAdmin", "platformAnalytics", "clinicAdmin"],
        buildBody: (a) => ({
          ...a,
          days: a.days ?? a.extraDays,
        }),
      }
    ),
    inviteClinicAdmin: mutationEndpoint(
      "superAdmin.inviteClinicAdmin",
      "POST",
      () => "/api/v1/super-admin/invitations",
      {
        invalidates: ["superAdmin"],
        buildBody: (a) => ({ ...a, role: "clinic_admin" }),
      }
    ),
    sendRenewalReminder: mutationEndpoint(
      "superAdmin.sendRenewalReminder",
      "POST",
      (a) => `/api/v1/super-admin/clinics/${a.clinicId}/renewal-reminder`
    ),
    listAllUsers: queryEndpoint<PlatformUsersListResult>(
      "superAdmin.users",
      () => "/api/v1/super-admin/users",
      {
        transform: (raw) => {
          if (Array.isArray(raw)) {
            return { callerIsRootOwner: true, users: raw as Array<UserDoc & AnyRecord> };
          }
          return raw as PlatformUsersListResult;
        },
      }
    ),
    updateUserRoleOrStatus: mutationEndpoint(
      "superAdmin.updateUser",
      "PATCH",
      (a) => `/api/v1/super-admin/users/${a.userId}`,
      { invalidates: ["superAdmin"] }
    ),
    listAllInvitations: queryEndpoint<Array<StaffInvitationDoc & AnyRecord>>(
      "superAdmin.invitations",
      () => "/api/v1/super-admin/invitations",
      { buildQuery: (a) => ({ status: a?.status }) }
    ),
    createRoleInvitation: mutationEndpoint(
      "superAdmin.createRoleInvitation",
      "POST",
      () => "/api/v1/super-admin/invitations",
      { invalidates: ["superAdmin"] }
    ),
    resendInvitation: mutationEndpoint(
      "superAdmin.resendInvitation",
      "POST",
      (a) => `/api/v1/super-admin/invitations/${a.invitationId}/resend`,
      { invalidates: ["superAdmin"] }
    ),
    revokeInvitation: mutationEndpoint(
      "superAdmin.revokeInvitation",
      "DELETE",
      (a) => `/api/v1/super-admin/invitations/${a.invitationId}`,
      { invalidates: ["superAdmin"], buildBody: () => undefined }
    ),
    listAnnouncements: queryEndpoint<SystemAnnouncementDoc[]>(
      "superAdmin.announcements",
      () => "/api/v1/super-admin/announcements"
    ),
    createAnnouncement: mutationEndpoint(
      "superAdmin.createAnnouncement",
      "POST",
      () => "/api/v1/super-admin/announcements",
      { invalidates: ["superAdmin", "clinicAdmin"] }
    ),
    updateAnnouncement: mutationEndpoint(
      "superAdmin.updateAnnouncement",
      "PATCH",
      (a) => `/api/v1/super-admin/announcements/${a.announcementId}`,
      { invalidates: ["superAdmin", "clinicAdmin"] }
    ),
    toggleAnnouncement: mutationEndpoint(
      "superAdmin.toggleAnnouncement",
      "PATCH",
      (a) => `/api/v1/super-admin/announcements/${a.announcementId}`,
      {
        invalidates: ["superAdmin", "clinicAdmin"],
        buildBody: (a) => ({ isActive: a.isActive }),
      }
    ),
    deleteAnnouncement: mutationEndpoint(
      "superAdmin.deleteAnnouncement",
      "DELETE",
      (a) => `/api/v1/super-admin/announcements/${a.announcementId}`,
      { invalidates: ["superAdmin", "clinicAdmin"], buildBody: () => undefined }
    ),
    listAuditLogs: queryEndpoint<AuditLogItem[]>(
      "superAdmin.auditLogs",
      () => "/api/v1/super-admin/audit-logs",
      {
        buildQuery: (a) => ({
          clinicId: a?.clinicId,
          actorUserId: a?.actorUserId,
          actionType: a?.actionType,
          limit: a?.limit,
          offset: a?.offset,
        }),
        transform: (raw) => {
          const items = Array.isArray(raw)
            ? (raw as AnyRecord[])
            : ((raw as { items?: AnyRecord[] })?.items ?? []);
          return items.map(normalizeAuditLog);
        },
      }
    ),
    listAuditLogsPaginated: queryEndpoint<{
      items: AuditLogItem[];
      total: number;
      limit: number;
      offset: number;
    }>(
      "superAdmin.auditLogsPaginated",
      () => "/api/v1/super-admin/audit-logs",
      {
        buildQuery: (a) => ({
          clinicId: a?.clinicId,
          actorUserId: a?.actorUserId,
          actionType: a?.actionType,
          limit: a?.limit,
          offset: a?.offset,
        }),
        transform: (raw) => {
          const page = (raw ?? {}) as {
            items?: AnyRecord[];
            total?: number;
            limit?: number;
            offset?: number;
          };
          return {
            items: (page.items ?? []).map(normalizeAuditLog),
            total: page.total ?? 0,
            limit: page.limit ?? 50,
            offset: page.offset ?? 0,
          };
        },
      }
    ),
    listAuditActors: queryEndpoint<Array<UserDoc & AnyRecord>>(
      "superAdmin.auditActors",
      () => "/api/v1/super-admin/audit-logs/actors"
    ),
    ensureDefaultPlans: mutationEndpoint(
      "superAdmin.ensureDefaultPlans",
      "POST",
      () => "/api/v1/super-admin/plans/ensure-defaults",
      { invalidates: ["subscriptions"] }
    ),
    triggerDailyRollup: mutationEndpoint(
      "superAdmin.triggerDailyRollup",
      "POST",
      () => "/api/v1/super-admin/analytics/trigger-rollup",
      { invalidates: ["platformAnalytics", "clinicAdmin"] }
    ),
  },

  subscriptions: {
    listPlans: queryEndpoint<SubscriptionPlanDoc[]>(
      "subscriptions.plans",
      () => "/api/v1/super-admin/plans"
    ),
    upsertPlan: mutationEndpoint(
      "subscriptions.upsertPlan",
      (a) => (a.planId ? "PUT" : "POST"),
      (a) =>
        a.planId
          ? `/api/v1/super-admin/plans/${a.planId}`
          : "/api/v1/super-admin/plans",
      { invalidates: ["subscriptions", "superAdmin"] }
    ),
    listPayments: queryEndpoint<PaymentDoc[]>(
      "subscriptions.payments",
      () => "/api/v1/super-admin/payments",
      {
        buildQuery: (a) => ({
          clinicId: a?.clinicId,
          status: a?.status,
          limit: a?.limit,
        }),
      }
    ),
    recordPayment: mutationEndpoint(
      "subscriptions.recordPayment",
      "POST",
      () => "/api/v1/super-admin/payments",
      {
        invalidates: ["subscriptions", "superAdmin", "platformAnalytics", "clinicAdmin"],
        buildBody: (a) => ({
          ...a,
          receiptStorageKey: a.receiptStorageKey ?? a.receiptStorageId,
        }),
      }
    ),
    updatePaymentStatus: mutationEndpoint(
      "subscriptions.updatePaymentStatus",
      "PATCH",
      (a) => `/api/v1/super-admin/payments/${a.paymentId}/status`,
      { invalidates: ["subscriptions", "superAdmin", "platformAnalytics"] }
    ),
    generateReceiptUploadUrl: mutationEndpoint(
      "subscriptions.generateReceiptUploadUrl",
      "POST",
      () => "/api/v1/storage/receipt/presign-upload"
    ),
  },

  platformAnalytics: {
    getDashboardOverview: queryEndpoint<PlatformDashboardOverviewData>(
      "platformAnalytics.overview",
      () => "/api/v1/super-admin/analytics/overview"
    ),
    getDailyMetricsSeries: queryEndpoint<AnyRecord[]>(
      "platformAnalytics.dailyMetrics",
      () => "/api/v1/super-admin/analytics/daily-metrics",
      { buildQuery: (a) => ({ days: a?.days }) }
    ),
    getClinicLeaderboard: queryEndpoint<AnyRecord[]>(
      "platformAnalytics.leaderboard",
      () => "/api/v1/super-admin/analytics/leaderboard",
      { buildQuery: (a) => ({ limit: a?.limit }) }
    ),
    getFreeTierUsage: queryEndpoint<FreeTierUsageData>(
      "platformAnalytics.freeTierUsage",
      () => "/api/v1/super-admin/analytics/free-tier-usage",
      {
        transform: (raw) => {
          const data = (raw ?? {}) as AnyRecord;
          const storage = (data.storage ?? {}) as AnyRecord;
          const emails = (data.emails ?? {}) as AnyRecord;
          const users = (data.users ?? {}) as AnyRecord;
          const clerkMau = (data.clerkMau ?? {}) as AnyRecord;
          const usersPct = clerkMau.percentUsed ?? users.percentUsed ?? users.usagePct ?? 0;
          return {
            ...data,
            storage: {
              topClinics: [],
              ...storage,
              percentUsed: storage.percentUsed ?? storage.usagePct ?? 0,
            },
            emails: {
              topClinics: [],
              ...emails,
              sentThisMonth: emails.sentThisMonth ?? emails.usedThisMonth ?? 0,
              monthlyLimit: emails.monthlyLimit ?? emails.limitPerMonth ?? 3000,
              percentUsed: emails.percentUsed ?? emails.usagePct ?? 0,
            },
            users: {
              ...users,
              percentUsed: usersPct,
            },
            clerkMau: {
              activeLast30Days:
                clerkMau.activeLast30Days ?? users.totalActive ?? 0,
              monthlyLimit: clerkMau.monthlyLimit ?? users.limitMau ?? 10000,
              percentUsed: usersPct,
            },
          } as unknown as FreeTierUsageData;
        },
      }
    ),
  },

  clinicAdmin: {
    getClinicWorkspace: queryEndpoint<
      {
        clinic: ClinicDoc;
        plan: SubscriptionPlanDoc | null;
        isReadOnly: boolean;
        readOnlyReason: string | null;
        isSuperAdminOverride: boolean;
        announcements: SystemAnnouncementDoc[];
      } & AnyRecord
    >("clinicAdmin.workspace", () => "/api/v1/clinic/workspace", {
      buildQuery: overrideQuery,
    }),
    getClinicBillingSummary: queryEndpoint<
      {
        clinic: ClinicDoc;
        plan: SubscriptionPlanDoc | null;
        payments: PaymentDoc[];
        availablePlans: SubscriptionPlanDoc[];
      } & AnyRecord
    >("clinicAdmin.billing", () => "/api/v1/clinic/billing", {
      buildQuery: overrideQuery,
      transform: (raw) => {
        const data = (raw ?? {}) as AnyRecord;
        return {
          ...data,
          availablePlans: Array.isArray(data.availablePlans)
            ? data.availablePlans
            : Array.isArray(data.plans)
              ? data.plans
              : data.plan
                ? [data.plan]
                : [],
        } as {
          clinic: ClinicDoc;
          plan: SubscriptionPlanDoc | null;
          payments: PaymentDoc[];
          availablePlans: SubscriptionPlanDoc[];
        } & AnyRecord;
      },
    }),
    getClinicDailyMetrics: queryEndpoint<ClinicDailyMetricsResult>(
      "clinicAdmin.dailyMetrics",
      () => "/api/v1/clinic/metrics/daily",
      {
        buildQuery: (a) => ({ ...overrideQuery(a), days: a?.days }),
        transform: (raw) => {
          if (Array.isArray(raw)) {
            const rows = raw as AnyRecord[];
            const totalBooked = rows.reduce((s, r) => s + Number(r.totalBooked ?? 0), 0);
            const completedCount = rows.reduce((s, r) => s + Number(r.completedCount ?? 0), 0);
            const cancelledCount = rows.reduce((s, r) => s + Number(r.cancelledCount ?? 0), 0);
            const noShowCount = rows.reduce((s, r) => s + Number(r.noShowCount ?? 0), 0);
            const estimatedRevenuePhp = rows.reduce(
              (s, r) => s + Number(r.estimatedRevenuePhp ?? 0),
              0
            );
            const newPatientsCount = rows.reduce(
              (s, r) => s + Number(r.newPatientsCount ?? 0),
              0
            );
            return {
              rows,
              totals: {
                totalBooked,
                completedCount,
                cancelledCount,
                noShowCount,
                estimatedRevenuePhp,
                newPatientsCount,
              },
              rates: {
                completionRatePct:
                  totalBooked > 0 ? Math.round((completedCount / totalBooked) * 100) : 0,
                noShowRatePct:
                  totalBooked > 0 ? Math.round((noShowCount / totalBooked) * 100) : 0,
                cancellationRatePct:
                  totalBooked > 0 ? Math.round((cancelledCount / totalBooked) * 100) : 0,
              },
              includesLiveToday: false,
              timeZone: "Asia/Manila",
              topServices: [],
              dentistUtilization: [],
            };
          }
          return raw as ClinicDailyMetricsResult;
        },
      }
    ),
    updateClinicSettings: mutationEndpoint(
      "clinicAdmin.updateSettings",
      "PATCH",
      () => "/api/v1/clinic/settings",
      {
        invalidates: ["clinicAdmin", "publicBooking"],
        buildBody: (a) => ({
          ...a,
          logoStorageKey: a.removeLogo
            ? null
            : (a.logoStorageKey ?? a.logoStorageId),
        }),
      }
    ),
    generateLogoUploadUrl: mutationEndpoint(
      "clinicAdmin.generateLogoUploadUrl",
      "POST",
      () => "/api/v1/storage/logo/presign-upload"
    ),
    listDentists: queryEndpoint<DentistsListResult>(
      "clinicAdmin.dentists",
      () => "/api/v1/clinic/dentists",
      {
        buildQuery: overrideQuery,
        transform: (raw) => {
          if (Array.isArray(raw)) {
            return {
              dentists: raw as Array<DentistDoc & AnyRecord>,
              chairs: [],
              availableUsers: [],
            };
          }
          return raw as DentistsListResult;
        },
      }
    ),
    createDentist: mutationEndpoint(
      "clinicAdmin.createDentist",
      "POST",
      () => "/api/v1/clinic/dentists",
      { invalidates: ["clinicAdmin", "appointments"] }
    ),
    updateDentist: mutationEndpoint(
      "clinicAdmin.updateDentist",
      "PATCH",
      (a) => `/api/v1/clinic/dentists/${a.dentistId}`,
      { invalidates: ["clinicAdmin", "appointments"] }
    ),
    toggleDentistActive: mutationEndpoint(
      "clinicAdmin.toggleDentist",
      "PATCH",
      (a) => `/api/v1/clinic/dentists/${a.dentistId}/toggle`,
      { invalidates: ["clinicAdmin", "appointments"] }
    ),
    addDentistTimeOff: mutationEndpoint(
      "clinicAdmin.addDentistTimeOff",
      "POST",
      (a) => `/api/v1/clinic/dentists/${a.dentistId}/time-off`,
      { invalidates: ["clinicAdmin", "appointments"] }
    ),
    deleteDentistTimeOff: mutationEndpoint(
      "clinicAdmin.deleteDentistTimeOff",
      "DELETE",
      (a) => `/api/v1/clinic/dentists/time-off/${a.timeOffId}`,
      { invalidates: ["clinicAdmin", "appointments"], buildBody: () => undefined }
    ),
    listChairs: queryEndpoint<ChairDoc[]>(
      "clinicAdmin.chairs",
      () => "/api/v1/clinic/chairs",
      { buildQuery: overrideQuery }
    ),
    createChair: mutationEndpoint(
      "clinicAdmin.createChair",
      "POST",
      () => "/api/v1/clinic/chairs",
      { invalidates: ["clinicAdmin", "appointments"] }
    ),
    updateChair: mutationEndpoint(
      "clinicAdmin.updateChair",
      "PATCH",
      (a) => `/api/v1/clinic/chairs/${a.chairId}`,
      { invalidates: ["clinicAdmin", "appointments"] }
    ),
    toggleChairActive: mutationEndpoint(
      "clinicAdmin.toggleChair",
      "PATCH",
      (a) => `/api/v1/clinic/chairs/${a.chairId}/toggle`,
      { invalidates: ["clinicAdmin", "appointments"] }
    ),
    listServices: queryEndpoint<ServiceDoc[]>(
      "clinicAdmin.services",
      () => "/api/v1/clinic/services",
      { buildQuery: overrideQuery }
    ),
    createService: mutationEndpoint(
      "clinicAdmin.createService",
      "POST",
      () => "/api/v1/clinic/services",
      { invalidates: ["clinicAdmin", "appointments", "publicBooking"] }
    ),
    updateService: mutationEndpoint(
      "clinicAdmin.updateService",
      "PATCH",
      (a) => `/api/v1/clinic/services/${a.serviceId}`,
      { invalidates: ["clinicAdmin", "appointments", "publicBooking"] }
    ),
    toggleServiceActive: mutationEndpoint(
      "clinicAdmin.toggleService",
      "PATCH",
      (a) => `/api/v1/clinic/services/${a.serviceId}/toggle`,
      { invalidates: ["clinicAdmin", "appointments", "publicBooking"] }
    ),
    seedDefaultServices: mutationEndpoint(
      "clinicAdmin.seedServices",
      "POST",
      () => "/api/v1/clinic/services/seed-defaults",
      { invalidates: ["clinicAdmin", "publicBooking"] }
    ),
    listStaff: queryEndpoint<
      {
        members: Array<UserDoc & AnyRecord>;
        staff: Array<UserDoc & AnyRecord>;
        invitations: Array<StaffInvitationDoc & AnyRecord>;
        pendingInvitations: Array<StaffInvitationDoc & AnyRecord>;
        declinedInvitations: Array<StaffInvitationDoc & AnyRecord>;
        historicalInvitations: Array<StaffInvitationDoc & AnyRecord>;
      } & AnyRecord
    >("clinicAdmin.staff", () => "/api/v1/clinic/staff", {
      buildQuery: overrideQuery,
      transform: (raw) => {
        const data = (raw ?? {}) as AnyRecord;
        const members = Array.isArray(data.members) ? data.members : [];
        const invitations = Array.isArray(data.invitations) ? data.invitations : [];
        return {
          ...data,
          members,
          staff: Array.isArray(data.staff) ? data.staff : members,
          invitations,
          pendingInvitations: Array.isArray(data.pendingInvitations)
            ? data.pendingInvitations
            : invitations.filter((i: AnyRecord) => i.status === "pending"),
          declinedInvitations: Array.isArray(data.declinedInvitations)
            ? data.declinedInvitations
            : invitations.filter((i: AnyRecord) => i.status === "declined"),
          historicalInvitations: Array.isArray(data.historicalInvitations)
            ? data.historicalInvitations
            : invitations.filter((i: AnyRecord) => i.status !== "pending"),
        } as {
          members: Array<UserDoc & AnyRecord>;
          staff: Array<UserDoc & AnyRecord>;
          invitations: Array<StaffInvitationDoc & AnyRecord>;
          pendingInvitations: Array<StaffInvitationDoc & AnyRecord>;
          declinedInvitations: Array<StaffInvitationDoc & AnyRecord>;
          historicalInvitations: Array<StaffInvitationDoc & AnyRecord>;
        } & AnyRecord;
      },
    }),
    inviteStaff: mutationEndpoint(
      "clinicAdmin.inviteStaff",
      "POST",
      () => "/api/v1/clinic/staff/invitations",
      { invalidates: ["clinicAdmin"] }
    ),
    resendStaffInvitation: mutationEndpoint(
      "clinicAdmin.resendStaffInvitation",
      "POST",
      (a) => `/api/v1/clinic/staff/invitations/${a.invitationId}/resend`,
      { invalidates: ["clinicAdmin"] }
    ),
    revokeStaffInvitation: mutationEndpoint(
      "clinicAdmin.revokeStaffInvitation",
      "DELETE",
      (a) => `/api/v1/clinic/staff/invitations/${a.invitationId}`,
      { invalidates: ["clinicAdmin"], buildBody: () => undefined }
    ),
    toggleStaffActive: mutationEndpoint(
      "clinicAdmin.toggleStaffActive",
      "PATCH",
      (a) => `/api/v1/clinic/staff/${a.userId}/toggle`,
      { invalidates: ["clinicAdmin"] }
    ),
  },

  appointments: {
    getFrontDeskWorkspace: queryEndpoint<FrontDeskWorkspaceData>(
      "appointments.frontDesk",
      () => "/api/v1/appointments/front-desk",
      {
        buildQuery: (a) => ({ ...overrideQuery(a), dateKey: a?.dateKey }),
        transform: (raw) => {
          const data = (raw ?? {}) as AnyRecord;
          const appts = Array.isArray(data.appointments) ? data.appointments : [];
          return {
            ...data,
            appointments: appts,
            pendingRequests: Array.isArray(data.pendingRequests)
              ? data.pendingRequests
              : appts.filter((a: AnyRecord) => a.status === "pending_approval"),
          } as FrontDeskWorkspaceData;
        },
      }
    ),
    searchClinicPatients: queryEndpoint<Array<PatientDoc & { hasMedicalAlert: boolean }>>(
      "appointments.searchPatients",
      () => "/api/v1/appointments/patients/search",
      {
        buildQuery: (a) => ({ ...overrideQuery(a), q: a?.search ?? a?.q }),
        transform: (raw) =>
          (Array.isArray(raw) ? (raw as PatientDoc[]) : []).map((p) => {
            const mh = p.medicalHistory;
            const hasMedicalAlert = Boolean(
              mh &&
                (mh.allergies?.length > 0 ||
                  mh.isTakingBloodThinners ||
                  mh.isPregnant ||
                  mh.dentalAnxietyLevel === "severe")
            );
            return { ...p, hasMedicalAlert };
          }),
      }
    ),
    getDentistQueue: queryEndpoint<DentistQueueData>(
      "appointments.dentistQueue",
      () => "/api/v1/appointments/dentist-queue",
      {
        buildQuery: (a) => ({
          ...overrideQuery(a),
          dateKey: a?.dateKey,
          rangeStartKey: a?.rangeStartKey,
          rangeEndKey: a?.rangeEndKey,
          dentistId: a?.dentistId,
        }),
      }
    ),
    createWalkInBooking: mutationEndpoint(
      "appointments.createWalkIn",
      "POST",
      () => "/api/v1/appointments/walk-in",
      { invalidates: ["appointments", "availability", "clinicAdmin"] }
    ),
    transitionStatus: mutationEndpoint(
      "appointments.transitionStatus",
      "PATCH",
      (a) => `/api/v1/appointments/${a.appointmentId}/status`,
      { invalidates: ["appointments", "availability", "patientPortal"] }
    ),
    rescheduleAppointment: mutationEndpoint(
      "appointments.reschedule",
      "PATCH",
      (a) => `/api/v1/appointments/${a.appointmentId}/reschedule`,
      { invalidates: ["appointments", "availability", "patientPortal"] }
    ),
    updateClinicalNotes: mutationEndpoint(
      "appointments.clinicalNotes",
      "PATCH",
      (a) => `/api/v1/appointments/${a.appointmentId}/clinical-notes`,
      { invalidates: ["appointments", "odontogram"] }
    ),
    addWaitlistEntry: mutationEndpoint(
      "appointments.addWaitlist",
      "POST",
      () => "/api/v1/appointments/waitlist",
      { invalidates: ["appointments", "waitlist"] }
    ),
    sendManualWaitlistOffer: mutationEndpoint(
      "appointments.sendWaitlistOffer",
      "POST",
      (a) => `/api/v1/appointments/waitlist/${a.waitlistId}/offer`,
      { invalidates: ["appointments", "waitlist"] }
    ),
    updateWaitlistStatus: mutationEndpoint(
      "appointments.updateWaitlistStatus",
      "PATCH",
      (a) => `/api/v1/appointments/waitlist/${a.waitlistId}/status`,
      { invalidates: ["appointments", "waitlist"] }
    ),
    getDentistTimeOff: queryEndpoint<DentistTimeOffResult>(
      "appointments.dentistTimeOff",
      () => "/api/v1/appointments/dentist-time-off",
      {
        buildQuery: (a) => ({ ...overrideQuery(a), dentistId: a?.dentistId }),
        transform: (raw) => {
          if (Array.isArray(raw)) {
            return { dentistId: null, dentistName: null, blocks: raw as AnyRecord[] };
          }
          return raw as DentistTimeOffResult;
        },
      }
    ),
    checkTimeOffConflicts: queryEndpoint<TimeOffConflictsResult>(
      "appointments.timeOffConflicts",
      () => "/api/v1/appointments/time-off-conflicts",
      {
        buildQuery: (a) => ({
          ...overrideQuery(a),
          dentistId: a?.dentistId,
          startTimeUtc: a?.startTimeUtc,
          endTimeUtc: a?.endTimeUtc,
        }),
        transform: (raw) =>
          Array.isArray(raw)
            ? { conflicts: raw as AnyRecord[] }
            : (raw as TimeOffConflictsResult),
      }
    ),
    createMyTimeOff: mutationEndpoint(
      "appointments.createMyTimeOff",
      "POST",
      () => "/api/v1/appointments/my-time-off",
      { invalidates: ["appointments", "availability", "clinicAdmin"] }
    ),
    removeMyTimeOff: mutationEndpoint(
      "appointments.removeMyTimeOff",
      "DELETE",
      (a) => `/api/v1/appointments/my-time-off/${a.timeOffId}`,
      { invalidates: ["appointments", "availability", "clinicAdmin"], buildBody: () => undefined }
    ),
  },

  availability: {
    getAvailableSlots: queryEndpoint<AvailableSlotsResult>(
      "availability.slots",
      (a) => `/api/v1/public/clinics/${a.clinicSlug ?? a.slug ?? a.clinicId}/slots`,
      {
        isPublic: true,
        buildQuery: (a) => ({
          serviceId: a?.serviceId,
          dateKey: a?.dateKey,
          preferredDentistId: a?.preferredDentistId,
          sessionId: a?.sessionId,
          ignoreAppointmentId: a?.ignoreAppointmentId,
          includeEmergencyBuffer: a?.includeEmergencyBuffer,
        }),
        transform: (raw) => {
          if (Array.isArray(raw)) {
            return {
              isBookable: true,
              blockedReason: null,
              slots: raw as AvailableSlot[],
            };
          }
          return raw as AvailableSlotsResult;
        },
      }
    ),
  },

  slotLocks: {
    acquireLock: mutationEndpoint(
      "slotLocks.acquire",
      "POST",
      (a) => `/api/v1/public/clinics/${a.clinicSlug ?? a.slug ?? a.clinicId}/slot-locks`,
      { isPublic: true, invalidates: ["availability"] }
    ),
    releaseSessionLock: mutationEndpoint(
      "slotLocks.release",
      "DELETE",
      (a) =>
        `/api/v1/public/clinics/${a.clinicSlug ?? a.slug ?? a.clinicId}/slot-locks/${a.dateKey ?? "today"}/${a.sessionId}`,
      { isPublic: true, invalidates: ["availability"], buildBody: () => undefined }
    ),
  },

  publicBooking: {
    listPublicClinics: queryEndpoint<PublicClinicSummary[]>(
      "publicBooking.clinics",
      () => "/api/v1/public/clinics",
      { isPublic: true }
    ),
    getPublicClinicBySlug: queryEndpoint<PublicClinicPortal>(
      "publicBooking.clinicBySlug",
      (a) => `/api/v1/public/clinics/${a.slug}`,
      {
        isPublic: true,
        transform: (raw) => {
          const data = raw as AnyRecord;
          const clinic = data?.clinic ?? {};
          const dentists = Array.isArray(data?.dentists)
            ? (data.dentists as AnyRecord[]).map((d) => ({
                ...d,
                workingDays: Array.isArray(d.workingDays)
                  ? d.workingDays
                  : (Array.isArray(d.weeklySchedule)
                      ? (d.weeklySchedule as Array<{ dayOfWeek: number; isWorking: boolean }>)
                          .filter((s) => s.isWorking)
                          .map((s) => s.dayOfWeek)
                      : []),
              }))
            : [];
          return {
            ...data,
            clinic: {
              ...clinic,
              isBookable: Boolean(data?.isBookable ?? clinic.isBookable ?? true),
              blockedReason: data?.unbookableReason ?? clinic.blockedReason ?? null,
              waitlistAutomationEnabled: Boolean(
                clinic.featureFlags?.waitlistAutomationEnabled ??
                  clinic.waitlistAutomationEnabled
              ),
            },
            dentists,
          } as PublicClinicPortal;
        },
      }
    ),
    getMyPatientProfilesForClinic: queryEndpoint<MyClinicProfilesResult>(
      "publicBooking.myProfiles",
      (a) => `/api/v1/patient/clinics/${a.clinicId}/profiles`,
      {
        transform: (raw) => {
          if (Array.isArray(raw)) {
            const list = raw as PatientDoc[];
            const selfProfile = list.find((p) => !p.guardianPatientId) ?? null;
            const dependents = list.filter((p) => Boolean(p.guardianPatientId));
            return {
              selfProfile,
              dependents,
              user: {
                firstName: selfProfile?.firstName ?? "",
                lastName: selfProfile?.lastName ?? "",
                email: selfProfile?.email ?? "",
                phone: selfProfile?.phone ?? "",
              },
            };
          }
          return raw as MyClinicProfilesResult;
        },
      }
    ),
    createOnlineBooking: mutationEndpoint(
      "publicBooking.createBooking",
      "POST",
      () => "/api/v1/patient/bookings",
      { invalidates: ["availability", "patientPortal", "appointments"] }
    ),
    cancelMyAppointment: mutationEndpoint(
      "publicBooking.cancelAppointment",
      "POST",
      (a) => `/api/v1/patient/appointments/${a.appointmentId}/cancel`,
      { invalidates: ["patientPortal", "availability", "appointments"] }
    ),
    rescheduleMyAppointment: mutationEndpoint(
      "publicBooking.rescheduleAppointment",
      "POST",
      (a) => `/api/v1/patient/appointments/${a.appointmentId}/reschedule`,
      { invalidates: ["patientPortal", "availability", "appointments"] }
    ),
  },

  patientPortal: {
    getDashboardData: queryEndpoint<PatientDashboardData>(
      "patientPortal.dashboard",
      () => "/api/v1/patient/dashboard"
    ),
    getMyClinicalSummary: queryEndpoint<PatientClinicalSummary>(
      "patientPortal.clinicalSummary",
      () => "/api/v1/patient/clinical-summary",
      { buildQuery: (a) => ({ patientId: a?.patientId }) }
    ),
    createSelfOrDependentProfile: mutationEndpoint(
      "patientPortal.createProfile",
      "POST",
      () => "/api/v1/patient/profiles",
      { invalidates: ["patientPortal", "publicBooking"] }
    ),
    updateMyMedicalProfile: mutationEndpoint(
      "patientPortal.updateMedical",
      "PATCH",
      (a) => `/api/v1/patient/profiles/${a.patientId}/medical`,
      { invalidates: ["patientPortal", "publicBooking"] }
    ),
    deleteDependentProfile: mutationEndpoint(
      "patientPortal.deleteDependent",
      "DELETE",
      (a) => `/api/v1/patient/profiles/${a.patientId}`,
      { invalidates: ["patientPortal", "publicBooking"], buildBody: () => undefined }
    ),
    leaveWaitlist: mutationEndpoint(
      "patientPortal.leaveWaitlist",
      "DELETE",
      (a) => `/api/v1/patient/waitlist/${a.waitlistId}`,
      { invalidates: ["patientPortal", "waitlist"], buildBody: () => undefined }
    ),
  },

  waitlist: {
    joinWaitlist: mutationEndpoint(
      "waitlist.join",
      "POST",
      () => "/api/v1/patient/waitlist",
      { invalidates: ["patientPortal", "waitlist"] }
    ),
    getWaitlistEntryForClaim: queryEndpoint<AnyRecord | null>(
      "waitlist.getForClaim",
      (a) => `/api/v1/patient/waitlist/${a.waitlistId}/claim`
    ),
    claimWaitlistSlot: mutationEndpoint(
      "waitlist.claim",
      "POST",
      (a) => `/api/v1/patient/waitlist/${a.waitlistId}/claim`,
      { invalidates: ["patientPortal", "waitlist", "availability", "appointments"] }
    ),
  },

  odontogram: {
    getPatientChart: queryEndpoint<PatientChartData>(
      "odontogram.patientChart",
      (a) => `/api/v1/clinical/patients/${a.patientId}/chart`,
      { buildQuery: overrideQuery }
    ),
    recordToothCondition: mutationEndpoint(
      "odontogram.recordTooth",
      "POST",
      (a) => `/api/v1/clinical/patients/${a.patientId}/tooth-records`,
      { invalidates: ["odontogram", "appointments"] }
    ),
    setPatientRecallDate: mutationEndpoint(
      "odontogram.setRecall",
      "PATCH",
      (a) => `/api/v1/clinical/patients/${a.patientId}/recall`,
      { invalidates: ["odontogram", "appointments"] }
    ),
  },

  files: {
    generateUploadUrl: mutationEndpoint(
      "files.presignUpload",
      "POST",
      () => "/api/v1/storage/clinical/presign-upload"
    ),
    saveClinicalFile: mutationEndpoint(
      "files.confirmUpload",
      "POST",
      () => "/api/v1/clinical/files/confirm",
      {
        invalidates: ["odontogram", "clinicAdmin"],
        buildBody: (a) => ({
          ...a,
          storageKey: a.storageKey ?? a.storageId,
        }),
      }
    ),
    deleteClinicalFile: mutationEndpoint(
      "files.deleteFile",
      "DELETE",
      (a) => `/api/v1/clinical/files/${a.fileId}`,
      { invalidates: ["odontogram", "clinicAdmin"], buildBody: () => undefined }
    ),
  },

  invitations: {
    getInvitationByToken: queryEndpoint<InvitationPublicDetails | null>(
      "invitations.byToken",
      (a) => `/api/v1/invitations/${encodeURIComponent(String(a.token))}`,
      { isPublic: true }
    ),
    acceptInvitationWithFallback: mutationEndpoint(
      "invitations.accept",
      "POST",
      (a) => `/api/v1/invitations/${encodeURIComponent(String(a.token))}/accept`,
      { invalidates: ["users", "invitations", "clinicAdmin", "superAdmin"] }
    ),
    declineInvitation: mutationEndpoint(
      "invitations.decline",
      "POST",
      (a) => `/api/v1/invitations/${encodeURIComponent(String(a.token))}/decline`,
      { invalidates: ["invitations"] }
    ),
  },
} as const;

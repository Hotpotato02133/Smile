export { API_BASE_URL, executeApiRequest, normalizeApiPayload } from "./client";
export { api } from "./endpoints";
export {
  useApiAuth,
  useApiMutation,
  useApiMutation as useAction,
  useApiMutation as useMutation,
  useApiPaginatedQuery,
  useApiPaginatedQuery as usePaginatedQuery,
  useApiQuery,
  useApiQuery as useQuery,
  useApiQueryState,
} from "./hooks";
export type {
  AppointmentItem,
  AuditLogItem,
  AvailableSlot,
  ChairDoc,
  ClinicDoc,
  ClinicalFileItem,
  DentistDoc,
  Doc,
  DocMap,
  InvitationPublicDetails,
  PatientDoc,
  PaymentDoc,
  PublicClinicPortal,
  PublicClinicSummary,
  ServiceDoc,
  StaffInvitationDoc,
  SubscriptionPlanDoc,
  SystemAnnouncementDoc,
  ToothRecordItem,
  UserDoc,
  WaitlistItem,
} from "./models";
export { SocketProvider, useRealtime } from "./socket-provider";
export { ApiClientError, type ApiEndpoint, type EndpointReturnType, type Id } from "./types";

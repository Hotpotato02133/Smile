/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as appointments from "../appointments.js";
import type * as availability from "../availability.js";
import type * as clinicAdmin from "../clinicAdmin.js";
import type * as cronJobs from "../cronJobs.js";
import type * as crons from "../crons.js";
import type * as emailSender from "../emailSender.js";
import type * as emails_templates from "../emails/templates.js";
import type * as files from "../files.js";
import type * as http from "../http.js";
import type * as invitations from "../invitations.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_permissions from "../lib/permissions.js";
import type * as lib_scheduling from "../lib/scheduling.js";
import type * as lib_serviceCatalog from "../lib/serviceCatalog.js";
import type * as notifications from "../notifications.js";
import type * as odontogram from "../odontogram.js";
import type * as patientPortal from "../patientPortal.js";
import type * as platformAnalytics from "../platformAnalytics.js";
import type * as publicBooking from "../publicBooking.js";
import type * as seed from "../seed.js";
import type * as slotLocks from "../slotLocks.js";
import type * as subscriptions from "../subscriptions.js";
import type * as superAdmin from "../superAdmin.js";
import type * as users from "../users.js";
import type * as waitlist from "../waitlist.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  appointments: typeof appointments;
  availability: typeof availability;
  clinicAdmin: typeof clinicAdmin;
  cronJobs: typeof cronJobs;
  crons: typeof crons;
  emailSender: typeof emailSender;
  "emails/templates": typeof emails_templates;
  files: typeof files;
  http: typeof http;
  invitations: typeof invitations;
  "lib/audit": typeof lib_audit;
  "lib/permissions": typeof lib_permissions;
  "lib/scheduling": typeof lib_scheduling;
  "lib/serviceCatalog": typeof lib_serviceCatalog;
  notifications: typeof notifications;
  odontogram: typeof odontogram;
  patientPortal: typeof patientPortal;
  platformAnalytics: typeof platformAnalytics;
  publicBooking: typeof publicBooking;
  seed: typeof seed;
  slotLocks: typeof slotLocks;
  subscriptions: typeof subscriptions;
  superAdmin: typeof superAdmin;
  users: typeof users;
  waitlist: typeof waitlist;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};

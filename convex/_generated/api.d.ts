/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as availability from "../availability.js";
import type * as clinicAdmin from "../clinicAdmin.js";
import type * as http from "../http.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_permissions from "../lib/permissions.js";
import type * as lib_scheduling from "../lib/scheduling.js";
import type * as lib_serviceCatalog from "../lib/serviceCatalog.js";
import type * as platformAnalytics from "../platformAnalytics.js";
import type * as publicBooking from "../publicBooking.js";
import type * as seed from "../seed.js";
import type * as slotLocks from "../slotLocks.js";
import type * as subscriptions from "../subscriptions.js";
import type * as superAdmin from "../superAdmin.js";
import type * as users from "../users.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  availability: typeof availability;
  clinicAdmin: typeof clinicAdmin;
  http: typeof http;
  "lib/audit": typeof lib_audit;
  "lib/permissions": typeof lib_permissions;
  "lib/scheduling": typeof lib_scheduling;
  "lib/serviceCatalog": typeof lib_serviceCatalog;
  platformAnalytics: typeof platformAnalytics;
  publicBooking: typeof publicBooking;
  seed: typeof seed;
  slotLocks: typeof slotLocks;
  subscriptions: typeof subscriptions;
  superAdmin: typeof superAdmin;
  users: typeof users;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

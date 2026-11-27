import type { ApiErrorResponse } from "@smile/shared";
import { ApiClientError } from "./types";

export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL?.trim() || "http://localhost:4000"
).replace(/\/+$/, "");

const TIMESTAMP_KEYS = new Set([
  "createdAt",
  "updatedAt",
  "startTimeUtc",
  "endTimeUtc",
  "bufferEndTimeUtc",
  "subscriptionStartsAt",
  "subscriptionEndsAt",
  "trialEndsAt",
  "gracePeriodEndsAt",
  "expiresAt",
  "respondedAt",
  "paidAt",
  "periodStart",
  "periodEnd",
  "lastLoginAt",
  "lastRollupAt",
]);

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

/**
 * Normalizes NestJS/Prisma JSON payloads for frontend components:
 *  - Mirrors `id` to `_id` (non-destructively) so existing UI keys/props work seamlessly.
 *  - Converts ISO-8601 timestamp strings on known timestamp fields to UTC epoch ms numbers.
 */
export function normalizeApiPayload<T>(value: T): T {
  if (value === null || value === undefined || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeApiPayload(item)) as unknown as T;
  }

  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};

  for (const [key, rawVal] of Object.entries(input)) {
    if (
      TIMESTAMP_KEYS.has(key) &&
      typeof rawVal === "string" &&
      ISO_DATE_RE.test(rawVal)
    ) {
      output[key] = Date.parse(rawVal);
    } else if (rawVal && typeof rawVal === "object") {
      output[key] = normalizeApiPayload(rawVal);
    } else {
      output[key] = rawVal;
    }
  }

  if (typeof output.id === "string" && output._id === undefined) {
    output._id = output.id;
  }
  if (typeof output.createdAt === "number" && output._creationTime === undefined) {
    output._creationTime = output.createdAt;
  }

  return output as T;
}

export async function executeApiRequest<T>(params: {
  path: string;
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  token?: string | null;
}): Promise<T> {
  const url = new URL(`${API_BASE_URL}${params.path}`);
  if (params.query) {
    for (const [k, v] of Object.entries(params.query)) {
      if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, String(v));
      }
    }
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (params.token) {
    headers.Authorization = `Bearer ${params.token}`;
  }
  if (params.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(url.toString(), {
    method: params.method,
    headers,
    ...(params.body !== undefined ? { body: JSON.stringify(params.body) } : {}),
    credentials: "include",
  });

  if (!res.ok) {
    let payload: Partial<ApiErrorResponse> = {};
    try {
      payload = (await res.json()) as Partial<ApiErrorResponse>;
    } catch {
      // Non-JSON error body
    }
    throw new ApiClientError({
      statusCode: payload.statusCode ?? res.status,
      code: payload.code ?? "INTERNAL_ERROR",
      message: payload.message ?? `Request failed with status ${res.status}`,
      details: payload.details,
    });
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const text = await res.text();
  if (!text) {
    return null as T;
  }

  const parsed = JSON.parse(text) as T;
  return normalizeApiPayload(parsed);
}

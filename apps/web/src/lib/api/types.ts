import type { ApiErrorResponse } from "@smile/shared";

/**
 * Brand-compatible entity identifier type replacing Convex `Id<Table>`.
 * All backend identifiers in PostgreSQL are UUID strings.
 */
export type Id<_Table extends string = string> = string;

export class ApiClientError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(payload: Partial<ApiErrorResponse> & { message: string }) {
    super(payload.message);
    this.name = "ApiClientError";
    this.statusCode = payload.statusCode ?? 500;
    this.code = payload.code ?? "INTERNAL_ERROR";
    this.details = payload.details;
  }
}

export interface ApiEndpoint<
  TArgs extends Record<string, unknown> = Record<string, unknown>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TResult = any,
> {
  readonly kind: "query" | "mutation";
  readonly key: string;
  readonly method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  readonly isPublic?: boolean;
  readonly invalidates?: readonly string[];
  readonly buildPath: (args: TArgs) => string;
  readonly buildQuery?: (args: TArgs) => Record<string, string | number | boolean | undefined>;
  readonly buildBody?: (args: TArgs) => unknown;
  readonly transform?: (raw: unknown) => TResult;
  readonly __resultType?: TResult;
}

export type EndpointReturnType<T> = T extends ApiEndpoint<Record<string, unknown>, infer R>
  ? R
  : unknown;

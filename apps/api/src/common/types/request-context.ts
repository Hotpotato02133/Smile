import type { Clinic, User } from "@prisma/client";
import type { Request } from "express";

export interface VerifiedClerkIdentity {
  clerkId: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  avatarUrl?: string;
  claims: Record<string, unknown>;
}

export interface AuthContext {
  identity: VerifiedClerkIdentity;
  user: User | null;
}

export interface TenantContext {
  clinicId: string;
  clinic: Clinic;
  isSuperAdminOverride: boolean;
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthContext;
  tenant?: TenantContext;
  rawBody?: Buffer;
}

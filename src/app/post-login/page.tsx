"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useEnvConfig } from "@/components/providers/app-providers";
import { getErrorMessage } from "@/lib/format";
import { api } from "../../../convex/_generated/api";

const ROLE_HOME = {
  super_admin: "/super-admin",
  clinic_admin: "/admin",
  receptionist: "/front-desk",
  dentist: "/staff",
  patient: "/patient",
} as const;

function PostLoginRedirector() {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const ensureUser = useMutation(api.users.ensureCurrentUser);
  const user = useQuery(api.users.current, isAuthenticated ? {} : "skip");
  const syncStartedRef = useRef(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated || user !== null || syncStartedRef.current) return;
    let cancelled = false;
    syncStartedRef.current = true;
    void ensureUser().catch((err: unknown) => {
      if (!cancelled) {
        setSyncError(getErrorMessage(err, "Unable to sync your account."));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user, ensureUser]);

  useEffect(() => {
    if (user) router.replace(ROLE_HOME[user.role]);
  }, [user, router]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/sign-in");
  }, [isLoading, isAuthenticated, router]);

  if (syncError) {
    return (
      <main className="flex flex-1 items-center justify-center p-6 text-sm text-destructive">
        {syncError}
      </main>
    );
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
      Setting up your account…
    </main>
  );
}

/** Post-sign-in landing: waits for the Clerk webhook to sync the user, then routes by role. */
export default function PostLoginPage() {
  const { isConfigured } = useEnvConfig();

  if (!isConfigured) {
    return (
      <main className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
        Configure Clerk and Convex keys in <code>.env.local</code> to complete sign-in routing.
      </main>
    );
  }

  return <PostLoginRedirector />;
}

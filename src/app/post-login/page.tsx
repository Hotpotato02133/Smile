"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useEnvConfig } from "@/components/providers/app-providers";
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
  const user = useQuery(api.users.current, isAuthenticated ? {} : "skip");

  useEffect(() => {
    if (user) router.replace(ROLE_HOME[user.role]);
  }, [user, router]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/sign-in");
  }, [isLoading, isAuthenticated, router]);

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

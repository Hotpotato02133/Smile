"use client";

import { UserButton } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { useEnvConfig } from "@/components/providers/app-providers";
import { api } from "../../../../convex/_generated/api";

function SuperAdminConnected() {
  const user = useQuery(api.users.current);

  return (
    <main className="flex flex-1 flex-col gap-4 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Super Admin</h1>
        <UserButton />
      </div>
      <p className="text-sm text-muted-foreground">
        {user === undefined
          ? "Loading…"
          : user
            ? `Signed in as ${user.email} (${user.role}).`
            : "Waiting for account sync…"}
      </p>
    </main>
  );
}

// Phase 1 placeholder; the full Super Admin command center is built in Phase 2.
export default function SuperAdminPage() {
  const { isConfigured } = useEnvConfig();

  if (!isConfigured) {
    return (
      <main className="flex flex-1 flex-col gap-4 p-8">
        <h1 className="text-2xl font-semibold">Super Admin</h1>
        <p className="text-sm text-muted-foreground">
          Configure Clerk and Convex environment variables in <code>.env.local</code> to access the Super Admin portal.
        </p>
      </main>
    );
  }

  return <SuperAdminConnected />;
}

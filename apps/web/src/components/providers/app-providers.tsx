"use client";

import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { shadcn } from "@clerk/ui/themes";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { createContext, type ReactNode, useContext } from "react";
import { Toaster } from "@/components/ui/sonner";

const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() ?? "";
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL?.trim() ?? "";

const hasClerk = Boolean(clerkPublishableKey);
const hasConvex = Boolean(convexUrl);
const convex = hasConvex ? new ConvexReactClient(convexUrl) : null;

type EnvConfig = {
  hasClerk: boolean;
  hasConvex: boolean;
  isConfigured: boolean;
};

const EnvConfigContext = createContext<EnvConfig>({
  hasClerk,
  hasConvex,
  isConfigured: hasClerk && hasConvex,
});

export function useEnvConfig(): EnvConfig {
  return useContext(EnvConfigContext);
}

function SetupNoticeBanner() {
  const missing: string[] = [];
  if (!hasClerk) missing.push("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY / CLERK_SECRET_KEY");
  if (!hasConvex) missing.push("NEXT_PUBLIC_CONVEX_URL");

  if (missing.length === 0) return null;

  return (
    <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-center text-xs text-amber-900 dark:text-amber-200">
      <span className="font-semibold">Local Setup Mode:</span> Populate{" "}
      <code className="rounded bg-amber-500/15 px-1 py-0.5 font-mono">
        {missing.join(", ")}
      </code>{" "}
      in <code className="rounded bg-amber-500/15 px-1 py-0.5 font-mono">.env.local</code>{" "}
      and run <code className="rounded bg-amber-500/15 px-1 py-0.5 font-mono">npx convex dev</code>{" "}
      to enable authentication and live database sync.
    </div>
  );
}

export function AppProviders({ children }: { children: ReactNode }) {
  const content = (
    <EnvConfigContext.Provider
      value={{ hasClerk, hasConvex, isConfigured: hasClerk && hasConvex }}
    >
      <SetupNoticeBanner />
      {children}
      <Toaster richColors position="top-right" />
    </EnvConfigContext.Provider>
  );

  if (!hasClerk) {
    return content;
  }

  if (!convex) {
    return (
      <ClerkProvider publishableKey={clerkPublishableKey} appearance={{ theme: shadcn }}>
        {content}
      </ClerkProvider>
    );
  }

  return (
    <ClerkProvider publishableKey={clerkPublishableKey} appearance={{ theme: shadcn }}>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        {content}
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}

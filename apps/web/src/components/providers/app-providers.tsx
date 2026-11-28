"use client";

import { ClerkProvider } from "@clerk/nextjs";
import { shadcn } from "@clerk/ui/themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { API_BASE_URL, ApiClientError, SocketProvider } from "@/lib/api";

const clerkPublishableKey =
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() ?? "";
const explicitApiUrl = process.env.NEXT_PUBLIC_API_URL?.trim() ?? "";
const hasClerk = Boolean(clerkPublishableKey);
const hasApi = Boolean(
  explicitApiUrl || (process.env.NODE_ENV !== "production" && API_BASE_URL)
);

type EnvConfig = {
  hasClerk: boolean;
  hasApi: boolean;
  isConfigured: boolean;
};

const EnvConfigContext = createContext<EnvConfig>({
  hasClerk,
  hasApi,
  isConfigured: hasClerk && hasApi,
});

export function useEnvConfig(): EnvConfig {
  return useContext(EnvConfigContext);
}

function SetupNoticeBanner() {
  const missing: string[] = [];
  if (!hasClerk) {
    missing.push("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY / CLERK_SECRET_KEY");
  }
  if (!hasApi) {
    missing.push("NEXT_PUBLIC_API_URL");
  }

  if (missing.length === 0) return null;

  return (
    <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-center text-xs text-amber-900 dark:text-amber-200">
      <span className="font-semibold">Local Setup Mode:</span> Populate{" "}
      <code className="rounded bg-amber-500/15 px-1 py-0.5 font-mono">
        {missing.join(", ")}
      </code>{" "}
      in <code className="rounded bg-amber-500/15 px-1 py-0.5 font-mono">apps/web/.env.local</code>{" "}
      and run <code className="rounded bg-amber-500/15 px-1 py-0.5 font-mono">npm run dev:api</code>{" "}
      to enable authentication and live backend sync.
    </div>
  );
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: (failureCount, error) => {
              if (
                error instanceof ApiClientError &&
                error.statusCode >= 400 &&
                error.statusCode < 500
              ) {
                return false;
              }
              return failureCount < 5;
            },
            retryDelay: (attemptIndex) =>
              Math.min(1000 * 2 ** attemptIndex, 8000),
            refetchOnReconnect: true,
            refetchOnWindowFocus: true,
          },
        },
      })
  );

  const content = (
    <EnvConfigContext.Provider
      value={{ hasClerk, hasApi, isConfigured: hasClerk && hasApi }}
    >
      <SetupNoticeBanner />
      {children}
      <Toaster richColors position="top-right" />
    </EnvConfigContext.Provider>
  );

  if (!hasClerk) {
    return (
      <QueryClientProvider client={queryClient}>{content}</QueryClientProvider>
    );
  }

  return (
    <ClerkProvider
      publishableKey={clerkPublishableKey}
      appearance={{ theme: shadcn }}
    >
      <QueryClientProvider client={queryClient}>
        <SocketProvider>{content}</SocketProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

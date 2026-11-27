"use client";

import { SignInButton, SignUpButton, useAuth, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { useEnvConfig } from "@/components/providers/app-providers";
import { Button } from "@/components/ui/button";

const emptySubscribe = () => () => {};

function useIsHydrated(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
}

function StaticSignedOutControls() {
  return (
    <div className="flex items-center gap-3">
      <Button render={<Link href="/sign-in" />}>Sign in</Button>
      <Button variant="outline" render={<Link href="/sign-up" />}>
        Create account
      </Button>
    </div>
  );
}

function ClerkAuthHeaderControls() {
  const hydrated = useIsHydrated();
  const { isLoaded, isSignedIn } = useAuth();

  if (!hydrated || !isLoaded) {
    return <StaticSignedOutControls />;
  }

  if (isSignedIn) {
    return (
      <div className="flex items-center gap-3">
        <Button variant="outline" render={<Link href="/post-login" />}>
          Go to Dashboard
        </Button>
        <UserButton />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <SignInButton>
        <Button>Sign in</Button>
      </SignInButton>
      <SignUpButton>
        <Button variant="outline">Create account</Button>
      </SignUpButton>
    </div>
  );
}

export function AuthHeaderControls() {
  const { hasClerk } = useEnvConfig();

  if (!hasClerk) {
    return <StaticSignedOutControls />;
  }

  return <ClerkAuthHeaderControls />;
}

"use client";

import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { Suspense } from "react";
import { useEnvConfig } from "@/components/providers/app-providers";
import { Button } from "@/components/ui/button";

export function AuthHeaderControls() {
  const { hasClerk } = useEnvConfig();

  if (!hasClerk) {
    return (
      <div className="flex items-center gap-3">
        <Button render={<Link href="/sign-in" />}>Sign in</Button>
        <Button variant="outline" render={<Link href="/sign-up" />}>
          Create account
        </Button>
      </div>
    );
  }

  return (
    <Suspense>
      <Show when="signed-out">
        <div className="flex items-center gap-3">
          <SignInButton>
            <Button>Sign in</Button>
          </SignInButton>
          <SignUpButton>
            <Button variant="outline">Create account</Button>
          </SignUpButton>
        </div>
      </Show>
      <Show when="signed-in">
        <div className="flex items-center gap-3">
          <Button variant="outline" render={<Link href="/post-login" />}>
            Go to Dashboard
          </Button>
          <UserButton />
        </div>
      </Show>
    </Suspense>
  );
}

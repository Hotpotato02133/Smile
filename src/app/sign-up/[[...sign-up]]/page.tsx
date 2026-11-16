"use client";

import { SignUp } from "@clerk/nextjs";
import Link from "next/link";
import { Suspense } from "react";
import { useEnvConfig } from "@/components/providers/app-providers";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function SignUpPage() {
  const { hasClerk } = useEnvConfig();

  if (!hasClerk) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Clerk Keys Required</CardTitle>
            <CardDescription>
              Add your Clerk keys to <code>.env.local</code> to enable account creation.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-muted-foreground">
            <p>Required in <code>.env.local</code>:</p>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-foreground">
              {`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CONVEX_URL=https://...convex.cloud
SUPER_ADMIN_EMAIL=you@example.com`}
            </pre>
          </CardContent>
          <CardFooter>
            <Button variant="outline" render={<Link href="/" />}>
              Back to home
            </Button>
          </CardFooter>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Suspense>
        <SignUp fallbackRedirectUrl="/post-login" />
      </Suspense>
    </main>
  );
}

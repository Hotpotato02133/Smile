"use client";

import { SignIn } from "@clerk/nextjs";
import Link from "next/link";
import { Suspense } from "react";
import {
  AuthPageShell,
  SMILE_CLERK_APPEARANCE,
} from "@/components/auth/auth-page-shell";
import { useEnvConfig } from "@/components/providers/app-providers";

export default function SignInPage() {
  const { hasClerk } = useEnvConfig();

  if (!hasClerk) {
    return (
      <AuthPageShell mode="sign-in">
        <div className="w-full rounded-[26px] border border-slate-200/85 bg-white p-6 sm:p-8">
          <h2 className="font-heading text-xl font-bold text-slate-950">
            Clerk Keys Required
          </h2>
          <p className="mt-1.5 text-sm text-slate-600">
            Add your Clerk keys to{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-900">
              .env.local
            </code>{" "}
            to enable sign-in.
          </p>
          <pre className="mt-4 overflow-x-auto rounded-2xl bg-[#F4F8FC] p-4 font-mono text-xs leading-relaxed text-slate-800">
            {`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_API_URL=http://localhost:4000
SUPER_ADMIN_EMAIL=you@example.com`}
          </pre>
          <div className="mt-5">
            <Link
              href="/"
              className="inline-flex h-11 w-full items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-semibold text-white transition-colors hover:bg-[#6C5CE7]"
            >
              Back to home
            </Link>
          </div>
        </div>
      </AuthPageShell>
    );
  }

  return (
    <AuthPageShell mode="sign-in">
      <Suspense
        fallback={
          <div className="h-[420px] w-full animate-pulse rounded-[26px] bg-[#F4F8FC]" />
        }
      >
        <SignIn
          fallbackRedirectUrl="/post-login"
          signUpUrl="/sign-up"
          appearance={SMILE_CLERK_APPEARANCE}
        />
      </Suspense>
    </AuthPageShell>
  );
}

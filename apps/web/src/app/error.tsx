"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled route error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center bg-[#F8FAFC] px-6 py-16 text-center">
      <div className="w-full max-w-md rounded-3xl border border-slate-200/80 bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-widest text-[#6C5CE7]">
          Smile Dental
        </p>
        <h1 className="mt-2 text-xl font-bold text-slate-950">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          We hit an unexpected error loading this page. Your saved data is safe.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-10 items-center justify-center rounded-full bg-[#6C5CE7] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#5B4BD6] cursor-pointer"
          >
            Try Again
          </button>
          <Link
            href="/"
            className="inline-flex h-10 items-center justify-center rounded-full bg-[#F5F7FA] px-5 text-sm font-semibold text-slate-800 hover:bg-[#EAF1F8]"
          >
            Go Home
          </Link>
        </div>
      </div>
    </div>
  );
}

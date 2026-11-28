"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col items-center justify-center bg-[#F8FAFC] px-6 py-16 text-center font-sans text-slate-900">
        <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="text-xl font-bold text-slate-950">
            Smile encountered a problem
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Please refresh or try again to reload the application.
          </p>
          <button
            type="button"
            onClick={reset}
            className="mt-6 inline-flex h-10 items-center justify-center rounded-full bg-[#6C5CE7] px-6 text-sm font-semibold text-white hover:bg-[#5B4BD6] cursor-pointer"
          >
            Reload App
          </button>
        </div>
      </body>
    </html>
  );
}

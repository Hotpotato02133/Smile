import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[75vh] flex-col items-center justify-center bg-[#F8FAFC] px-6 py-16 text-center">
      <div className="w-full max-w-md rounded-3xl border border-slate-200/80 bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-widest text-[#6C5CE7]">
          404 · Not Found
        </p>
        <h1 className="mt-2 text-2xl font-bold text-slate-950">
          Page not found
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          The clinic portal or dashboard link you visited does not exist or has
          moved.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Link
            href="/"
            className="inline-flex h-10 items-center justify-center rounded-full bg-[#6C5CE7] px-5 text-sm font-semibold text-white hover:bg-[#5B4BD6]"
          >
            Return Home
          </Link>
          <Link
            href="/clinics"
            className="inline-flex h-10 items-center justify-center rounded-full bg-[#F5F7FA] px-5 text-sm font-semibold text-slate-800 hover:bg-[#EAF1F8]"
          >
            Browse Clinics
          </Link>
        </div>
      </div>
    </div>
  );
}

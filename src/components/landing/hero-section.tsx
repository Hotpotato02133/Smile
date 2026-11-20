import Image from "next/image";
import Link from "next/link";
import {
  ArrowUpRight,
  CalendarCheck2,
  Clock3,
  ShieldCheck,
  Sparkles,
  Stethoscope,
} from "lucide-react";

const SPECIALIST_BADGES = [
  { initials: "CR", bg: "bg-[#6C5CE7] text-white" },
  { initials: "ML", bg: "bg-[#0EA5E9] text-white" },
  { initials: "AT", bg: "bg-slate-900 text-white" },
];

export function HeroSection() {
  return (
    <section
      id="top"
      className="mx-auto w-full max-w-[1280px] px-4 pt-3 pb-10 sm:px-6 lg:px-8 lg:pt-4 lg:pb-14"
    >
      <div className="relative">
        {/* Main Framed Photographic Hero Card */}
        <div className="relative min-h-[520px] sm:min-h-[560px] lg:min-h-[620px] w-full overflow-hidden rounded-[26px] sm:rounded-[32px] lg:rounded-[36px] bg-slate-900">
          <Image
            src="/images/hero-dental-smile.jpg"
            alt="Smiling dental patient relaxing in a bright modern dental clinic chair during a gentle routine checkup"
            fill
            priority
            fetchPriority="high"
            sizes="(max-width: 1280px) 100vw, 1216px"
            className="object-cover object-[64%_22%] sm:object-[58%_20%]"
          />

          {/* Neutral Editorial Scrim for Text Readability */}
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-r from-slate-950/76 via-slate-950/38 to-transparent"
          />

          {/* Top-Right Quick Jump Icon Cluster */}
          <div className="absolute top-4 right-4 z-20 hidden sm:flex items-center gap-1.5 rounded-full bg-white/95 p-1.5">
            <a
              href="#capabilities"
              aria-label="Jump to platform capabilities"
              className="inline-flex size-8 items-center justify-center rounded-full bg-slate-950 text-white transition-transform hover:scale-105"
            >
              <Stethoscope className="size-3.5" aria-hidden="true" />
            </a>
            <a
              href="#live-preview"
              aria-label="Jump to live scheduling preview"
              className="inline-flex size-8 items-center justify-center rounded-full bg-white text-slate-800 transition-colors hover:bg-[#F1EEFF] hover:text-[#6C5CE7]"
            >
              <CalendarCheck2 className="size-3.5" aria-hidden="true" />
            </a>
            <a
              href="#pricing"
              aria-label="Jump to clinic plans"
              className="inline-flex size-8 items-center justify-center rounded-full bg-white text-slate-800 transition-colors hover:bg-[#F1EEFF] hover:text-[#6C5CE7]"
            >
              <ShieldCheck className="size-3.5" aria-hidden="true" />
            </a>
          </div>

          {/* Inner Content Layout */}
          <div className="relative z-10 flex min-h-[520px] sm:min-h-[560px] lg:min-h-[620px] flex-col justify-between p-5 sm:p-8 lg:p-12">
            {/* Middle Split: Headline Left + Live Operatory Card Right */}
            <div className="mt-5 sm:mt-8 lg:mt-14 grid grid-cols-1 items-start gap-8 lg:grid-cols-12">
              {/* Left Copy Column */}
              <div className="lg:col-span-7 max-w-2xl">
                <h1 className="font-heading text-[2rem] leading-[1.06] font-bold tracking-[-0.03em] text-white sm:text-5xl lg:text-[3.5rem]">
                  Smart Dental Care,
                  <br />
                  Booked in Seconds
                </h1>

                <p className="mt-4 max-w-md text-base leading-relaxed text-white/92">
                  24/7 dual-resource scheduling that syncs dentists, operatory
                  chairs, and 5-minute slot holds for modern clinics.
                </p>

                {/* Primary & Secondary Reference Pill Actions */}
                <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                  <Link
                    href="/clinics"
                    className="inline-flex h-12 items-center justify-center gap-2.5 rounded-full bg-slate-950 pl-2 pr-5 text-sm font-semibold text-white transition-transform hover:-translate-y-0.5 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:justify-start"
                  >
                    <span className="inline-flex size-8 items-center justify-center rounded-full bg-white text-slate-950">
                      <CalendarCheck2 className="size-4" aria-hidden="true" />
                    </span>
                    <span>Browse Dental Clinics</span>
                  </Link>

                  <Link
                    href="/sign-up"
                    className="inline-flex h-12 items-center justify-center gap-2.5 rounded-full bg-white pl-2 pr-5 text-sm font-semibold text-slate-950 transition-transform hover:-translate-y-0.5 hover:bg-[#F1EEFF] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:justify-start"
                  >
                    <span className="inline-flex size-8 items-center justify-center rounded-full bg-slate-950 text-white">
                      <ArrowUpRight className="size-4" aria-hidden="true" />
                    </span>
                    <span>Launch Your Clinic</span>
                  </Link>
                </div>
              </div>

              {/* Right Live Smile Scheduling Card (data-ui) */}
              <div className="hidden lg:flex lg:col-span-5 lg:justify-end lg:pt-2">
                <div
                  data-ui="hero-operatory-sync"
                  className="w-[276px] rounded-[24px] border border-white/25 bg-slate-950/62 p-4 text-white"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-medium text-white/90">
                      Live Slot Lock
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-slate-950">
                      <Clock3 className="size-3 text-[#6C5CE7]" aria-hidden="true" />
                      0 Double-Books
                    </span>
                  </div>

                  <div className="mt-3.5 flex items-center gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#6C5CE7] text-xs font-bold text-white">
                      CR
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">
                        Dr. Camille Reyes
                      </p>
                      <p className="truncate text-[13px] text-white/80">
                        Operatory Chair 2 · General
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl bg-white/14 p-3">
                    <div className="flex items-center justify-between text-[13px] text-white/85">
                      <span>Sterilization Buffer</span>
                      <span className="font-semibold text-white">+15 min</span>
                    </div>
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/20">
                      <div className="h-full w-[78%] rounded-full bg-[#A59BFF]" />
                    </div>
                    <div className="mt-3 flex items-baseline gap-1.5">
                      <span className="font-heading text-3xl font-bold tabular-nums tracking-tight text-white">
                        05:00
                      </span>
                      <span className="text-[13px] text-white/85">
                        min ACID hold
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Row Inside Hero */}
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between lg:mt-10">
              {/* Compact Floating Clinic Proof Card (Tablet + Desktop only to keep Mobile ultra-clean) */}
              <div className="hidden sm:inline-flex max-w-[272px] items-center justify-between gap-3 rounded-2xl bg-white p-3.5 text-slate-900 lg:mb-16">
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center -space-x-2">
                    {SPECIALIST_BADGES.map((badge) => (
                      <span
                        key={badge.initials}
                        className={`inline-flex size-7 items-center justify-center rounded-full border-2 border-white text-xs font-bold ${badge.bg}`}
                      >
                        {badge.initials}
                      </span>
                    ))}
                  </div>
                  <p className="text-[13px] leading-snug font-medium text-slate-700">
                    Dentist + Chair availability synced in real time
                  </p>
                </div>
                <Link
                  href="/clinics"
                  aria-label="Open verified clinics directory"
                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-[#F5F7FA] text-slate-900 transition-colors hover:bg-[#6C5CE7] hover:text-white"
                >
                  <ArrowUpRight className="size-4" aria-hidden="true" />
                </Link>
              </div>

              {/* Bottom-Right Specialist Pill Row */}
              <div className="inline-flex items-center gap-2 self-start sm:self-end rounded-full bg-white p-1.5">
                <div className="flex items-center -space-x-1.5 pl-1">
                  {SPECIALIST_BADGES.map((badge) => (
                    <span
                      key={badge.initials}
                      className={`inline-flex size-7 items-center justify-center rounded-full border-2 border-white text-xs font-bold ${badge.bg}`}
                    >
                      {badge.initials}
                    </span>
                  ))}
                </div>
                <Link
                  href="/clinics"
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#F5F7FA] px-3.5 py-1.5 text-[13px] font-semibold text-slate-900 transition-colors hover:bg-[#6C5CE7] hover:text-white"
                >
                  <Sparkles className="size-3.5 text-[#6C5CE7]" aria-hidden="true" />
                  <span>Verified Dental Clinics</span>
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Architectural Bottom-Left White Cutout Notch (Placed OUTSIDE overflow-hidden so zero corner clipping!) */}
        <div className="hidden lg:block absolute bottom-0 left-0 z-20 w-[44%] max-w-[480px] rounded-tr-[32px] bg-white pt-5 pr-8 pb-2 pl-2">
          <p className="text-[15px] leading-snug font-medium text-slate-700">
            Ready when your patients are—instant dual-resource booking with zero
            chair collisions.
          </p>
        </div>

        {/* Mobile/Tablet Clean Statement Strip Below Hero Card */}
        <div className="mt-4 flex flex-col gap-3 rounded-2xl bg-[#EEF7FD] p-4 sm:flex-row sm:items-center sm:justify-between lg:hidden">
          <p className="text-sm font-medium text-slate-800">
            Ready when your patients are—instant dual-resource booking with zero
            chair collisions.
          </p>
          <span className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-full bg-white px-3 py-1 text-[13px] font-semibold text-[#5B4BD6] sm:self-center">
            <Clock3 className="size-3.5" aria-hidden="true" />
            <span>5-min ACID slot lock</span>
          </span>
        </div>
      </div>
    </section>
  );
}

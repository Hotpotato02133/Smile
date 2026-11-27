"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Building2,
  ClipboardCheck,
  ShieldCheck,
  Stethoscope,
  UserCheck,
} from "lucide-react";
import { cn } from "cn";
import { ScrollReveal } from "@/components/landing/scroll-reveal";

interface RoleWorkflow {
  id: string;
  title: string;
  description: string;
  badge: string;
  image: string;
  imageAlt: string;
  ctaLabel: string;
  ctaHref: string;
}

const ROLE_WORKFLOWS: RoleWorkflow[] = [
  {
    id: "patient",
    title: "4-Step Patient Self-Booking",
    description:
      "Patients pick a dental procedure, select a dentist or first available slot, book for family dependents, and confirm with a 5-minute hold plus .ICS calendar export.",
    badge: "Public Portal · /c/[clinic-slug]",
    image: "/images/modern-dental-suite.jpg",
    imageAlt:
      "Bright sunlit modern dental operatory chair ready for an upcoming scheduled patient appointment",
    ctaLabel: "Browse Dental Clinics",
    ctaHref: "/clinics",
  },
  {
    id: "dentist",
    title: "Chairside Dentist Workspace",
    description:
      "Inspect your daily queue with high-contrast allergy and blood-thinner alerts, chart treatments on the 32-tooth SVG odontogram, and schedule 6-month recalls in one click.",
    badge: "Clinical View · /staff",
    image: "/images/clinic-team-care.jpg",
    imageAlt:
      "Dental specialists collaborating over a digital patient odontogram chart on a clinical workstation",
    ctaLabel: "Open Staff Portal",
    ctaHref: "/sign-in",
  },
  {
    id: "front-desk",
    title: "Front-Desk Command Center",
    description:
      "Run a multi-chair master calendar alongside a live patient-flow Kanban board, quick-book walk-ins without accounts, and notify waitlisted patients on cancellations.",
    badge: "Reception · /front-desk",
    image: "/images/modern-dental-suite.jpg",
    imageAlt:
      "Contemporary dental suite prepared by front-desk reception and sterilization workflow",
    ctaLabel: "Explore Clinic Admin",
    ctaHref: "/sign-up",
  },
  {
    id: "multi-clinic",
    title: "Multi-Clinic SaaS Governance",
    description:
      "Isolate every practice by strict clinicId indexes, enforce subscription plan quotas automatically, track GCash and Maya renewals, and log every sensitive change.",
    badge: "Enterprise Isolation",
    image: "/images/clinic-team-care.jpg",
    imageAlt:
      "Dental clinic leadership team reviewing multi-chair scheduling analytics together",
    ctaLabel: "See Clinic Plans",
    ctaHref: "#pricing",
  },
];

export function RoleSpotlightSection() {
  const [activeId, setActiveId] = useState<string>(ROLE_WORKFLOWS[0].id);
  const activeWorkflow =
    ROLE_WORKFLOWS.find((w) => w.id === activeId) ?? ROLE_WORKFLOWS[0];

  return (
    <section
      id="workflows"
      className="mx-auto w-full max-w-[1280px] px-4 py-16 sm:px-6 lg:px-8 lg:py-24"
    >
      {/* Top Asymmetric Header Row */}
      <ScrollReveal className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <h2 className="font-heading text-3xl leading-[1.1] font-bold tracking-[-0.03em] text-slate-950 sm:text-4xl lg:text-[2.65rem]">
          One workspace for
          <br className="hidden sm:inline" /> every clinic role
        </h2>
        <p className="max-w-md text-base leading-relaxed text-slate-700 lg:text-right">
          From mobile patient bookings to chairside odontogram updates, every
          role operates on one synchronized, tenant-isolated schedule.
        </p>
      </ScrollReveal>

      {/* Split Photo + Stacked Accent Cards */}
      <ScrollReveal
        delayMs={90}
        className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-12 lg:gap-8 lg:items-stretch"
      >
        {/* Left Framed Photo Card */}
        <div className="relative min-h-[300px] sm:min-h-[380px] lg:col-span-5 overflow-hidden rounded-[28px] bg-slate-100">
          <Image
            src={activeWorkflow.image}
            alt={activeWorkflow.imageAlt}
            fill
            loading="lazy"
            sizes="(max-width: 1024px) 100vw, 42vw"
            className="object-cover transition-transform duration-500"
          />

          {/* Top-Right Compact Role Indicator Badges */}
          <div className="absolute top-4 right-4 flex items-center gap-1.5">
            <span className="inline-flex size-9 items-center justify-center rounded-full bg-[#6C5CE7] text-white">
              <Stethoscope className="size-4" aria-hidden="true" />
            </span>
            <span className="inline-flex size-9 items-center justify-center rounded-full bg-white text-slate-900">
              <ShieldCheck className="size-4" aria-hidden="true" />
            </span>
          </div>

          {/* Bottom-Left Context Pill + CTA */}
          <div className="absolute inset-x-4 bottom-4 flex flex-wrap items-center justify-between gap-2">
            <Link
              href={activeWorkflow.ctaHref}
              className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[13px] font-semibold text-slate-950 transition-colors hover:bg-[#6C5CE7] hover:text-white"
            >
              <span>{activeWorkflow.ctaLabel}</span>
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </Link>

            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-950/85 px-3 py-1.5 text-[13px] font-medium text-white">
              {activeWorkflow.id === "patient" ? (
                <UserCheck className="size-3.5 text-[#C4BCFF]" aria-hidden="true" />
              ) : activeWorkflow.id === "multi-clinic" ? (
                <Building2 className="size-3.5 text-[#C4BCFF]" aria-hidden="true" />
              ) : (
                <ClipboardCheck className="size-3.5 text-[#C4BCFF]" aria-hidden="true" />
              )}
              <span>{activeWorkflow.badge}</span>
            </span>
          </div>
        </div>

        {/* Right Stacked Interactive Highlight Rows */}
        <div className="flex flex-col justify-between gap-3.5 lg:col-span-7">
          {ROLE_WORKFLOWS.map((workflow) => {
            const isActive = workflow.id === activeId;
            return (
              <button
                key={workflow.id}
                type="button"
                onClick={() => setActiveId(workflow.id)}
                aria-expanded={isActive}
                className={cn(
                  "group flex w-full items-center justify-between gap-4 rounded-[24px] px-6 py-5 text-left transition-all duration-200 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6C5CE7]",
                  isActive
                    ? "bg-[#6C5CE7] text-white py-6"
                    : "bg-[#F7F9FC] text-slate-900 hover:bg-[#EEF7FD]"
                )}
              >
                <div className="min-w-0 flex-1">
                  <h3
                    className={cn(
                      "font-heading text-lg font-bold tracking-tight sm:text-xl",
                      isActive ? "text-white" : "text-slate-950"
                    )}
                  >
                    {workflow.title}
                  </h3>
                  {isActive ? (
                    <p className="mt-2 max-w-[54ch] text-base leading-relaxed text-white/95">
                      {workflow.description}
                    </p>
                  ) : null}
                </div>

                <span
                  aria-hidden="true"
                  className={cn(
                    "inline-flex shrink-0 items-center justify-center rounded-full transition-transform duration-200",
                    isActive
                      ? "size-11 bg-white text-slate-950 group-hover:scale-105"
                      : "size-9 bg-white text-slate-700 group-hover:translate-x-0.5 group-hover:text-[#6C5CE7]"
                  )}
                >
                  {isActive ? (
                    <ArrowUpRight className="size-5" />
                  ) : (
                    <ArrowRight className="size-4" />
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </ScrollReveal>
    </section>
  );
}

"use client";

import { useState } from "react";
import {
  ArrowRight,
  CalendarClock,
  KanbanSquare,
  LockKeyhole,
  Plus,
  ScanLine,
  Smile,
} from "lucide-react";
import { cn } from "cn";
import { ScrollReveal } from "@/components/landing/scroll-reveal";

interface CapabilityItem {
  id: string;
  title: string;
  shortLabel: string;
  summary: string;
  metric: string;
  icon: typeof CalendarClock;
  slot: "top-left" | "center" | "top-right" | "bottom-left" | "bottom-right";
}

const CAPABILITIES: CapabilityItem[] = [
  {
    id: "dual-resource",
    title: "Dual-Resource Sync",
    shortLabel: "Dentist + Chair Engine",
    summary:
      "Every appointment verifies both an available dentist and a procedure-compatible operatory chair, including automatic sterilization turnover buffers.",
    metric: "ACID zero double-books",
    icon: CalendarClock,
    slot: "top-left",
  },
  {
    id: "odontogram",
    title: "32-Tooth Odontogram",
    shortLabel: "5-Surface Clinical Charting",
    summary:
      "Interactive adult arch charting across all 32 teeth and 5 geometric surfaces with instant crimson medical alerts for allergies, blood thinners, and anxiety.",
    metric: "160 clickable tooth surfaces",
    icon: Smile,
    slot: "center",
  },
  {
    id: "slot-locks",
    title: "5-Min Slot Locking",
    shortLabel: "Collision-Proof Holds",
    summary:
      "The moment a patient selects a time slot, Smile places an automatic 5-minute reservation lock so two patients never race for the same chair.",
    metric: "Auto-releasing 300s hold",
    icon: LockKeyhole,
    slot: "top-right",
  },
  {
    id: "kanban",
    title: "Front-Desk Kanban",
    shortLabel: "Live Waiting Room Flow",
    summary:
      "Move patients seamlessly from Scheduled to Checked In, In Chair, and Completed—flashing real-time arrivals directly on the assigned dentist's tablet.",
    metric: "Real-time chair status",
    icon: KanbanSquare,
    slot: "bottom-left",
  },
  {
    id: "xray-vault",
    title: "X-Ray & Photo Vault",
    shortLabel: "Compressed Clinical Storage",
    summary:
      "Upload periapical X-rays and before-and-after intraoral photos with automatic browser-side WebP compression capped under 500 KB per image.",
    metric: "2,000+ X-rays per clinic",
    icon: ScanLine,
    slot: "bottom-right",
  },
];

export function CapabilitiesBento() {
  const [activeId, setActiveId] = useState<string>("odontogram");
  const activeItem =
    CAPABILITIES.find((item) => item.id === activeId) ?? CAPABILITIES[1];

  const bySlot = (slot: CapabilityItem["slot"]) =>
    CAPABILITIES.find((item) => item.slot === slot)!;

  const mobileOrdered = [
    bySlot("center"),
    bySlot("top-left"),
    bySlot("top-right"),
    bySlot("bottom-left"),
    bySlot("bottom-right"),
  ];

  const renderTile = (item: CapabilityItem, featured = false) => {
    const Icon = item.icon;
    const isActive = item.id === activeId;

    return (
      <button
        key={item.id}
        type="button"
        onClick={() => setActiveId(item.id)}
        aria-pressed={isActive}
        className={cn(
          "group flex w-full flex-col items-center justify-center rounded-[24px] text-center transition-all duration-200 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6C5CE7]",
          featured
            ? "min-h-[186px] px-6 py-8 md:min-h-[214px]"
            : "min-h-[148px] px-4 py-6",
          isActive
            ? "bg-[#E6E2FF] text-slate-950 -translate-y-0.5"
            : "bg-[#EEF7FD] text-slate-900 hover:bg-[#E2F0FA] hover:-translate-y-0.5"
        )}
      >
        <span
          className={cn(
            "inline-flex items-center justify-center rounded-2xl transition-colors",
            featured ? "size-14 mb-4" : "size-11 mb-3",
            isActive
              ? "bg-[#6C5CE7] text-white"
              : "bg-white text-slate-800 group-hover:text-[#6C5CE7]"
          )}
        >
          <Icon
            className={featured ? "size-7" : "size-5"}
            strokeWidth={1.75}
            aria-hidden="true"
          />
        </span>
        <span
          className={cn(
            "font-heading font-bold tracking-tight",
            featured ? "text-lg sm:text-xl" : "text-base",
            "text-slate-950"
          )}
        >
          {item.title}
        </span>
        <span className="mt-1 text-[13px] font-medium text-slate-700">
          {item.shortLabel}
        </span>
      </button>
    );
  };

  return (
    <section
      id="capabilities"
      className="mx-auto w-full max-w-[1280px] px-4 py-16 sm:px-6 lg:px-8 lg:py-24"
    >
      {/* Centered Heading + Subtle Pill Action (Reference Layout) */}
      <ScrollReveal className="mx-auto flex max-w-2xl flex-col items-center text-center">
        <h2 className="font-heading text-3xl leading-[1.12] font-bold tracking-[-0.03em] text-slate-950 sm:text-4xl lg:text-[2.75rem]">
          Built for every part
          <br />
          of modern dentistry
        </h2>
        <p className="mt-4 max-w-lg text-base leading-relaxed text-slate-700">
          Select any capability below to inspect how Smile replaces paper
          charts, double-booked chairs, and disconnected reception desks.
        </p>
        <a
          href="#live-preview"
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-[#F4F6FA] px-5 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-[#E6E2FF] hover:text-[#4F3EC7]"
        >
          <span>Try interactive scheduler</span>
          <ArrowRight className="size-4" aria-hidden="true" />
        </a>
      </ScrollReveal>

      {/* Desktop Asymmetric Staggered Mosaic (Mirrors Reference Composition) */}
      <ScrollReveal
        delayMs={80}
        className="mx-auto mt-12 hidden max-w-[940px] md:grid md:grid-cols-12 md:gap-5 md:items-start"
      >
        {/* Left Staggered Column */}
        <div className="col-span-4 flex flex-col gap-5 pt-7">
          {renderTile(bySlot("top-left"))}
          <div className="pl-6">{renderTile(bySlot("bottom-left"))}</div>
        </div>

        {/* Center Focal Column + Editorial Detail Note */}
        <div className="col-span-4 flex flex-col gap-4">
          {renderTile(bySlot("center"), true)}

          {/* Reference "+" Callout Card */}
          <div className="relative rounded-[22px] bg-[#F5F8FC] p-5 text-left transition-all">
            <span
              aria-hidden="true"
              className="absolute -top-3 -left-3 inline-flex size-7 items-center justify-center rounded-full bg-white text-[#5B4BD6]"
            >
              <Plus className="size-3.5" />
            </span>
            <p className="text-[13px] font-semibold text-[#5B4BD6]">
              {activeItem.metric}
            </p>
            <h3 className="mt-1 font-heading text-base font-bold text-slate-950">
              {activeItem.title}
            </h3>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-700">
              {activeItem.summary}
            </p>
          </div>
        </div>

        {/* Right Staggered Column */}
        <div className="col-span-4 flex flex-col gap-5 pt-2">
          <div className="pr-5">{renderTile(bySlot("top-right"))}</div>
          {renderTile(bySlot("bottom-right"))}
        </div>
      </ScrollReveal>

      {/* Mobile Balanced 1+2+2 Grid + Active Detail Card (Zero Orphan Holes) */}
      <ScrollReveal delayMs={80} className="mt-10 flex flex-col gap-4 md:hidden">
        <div className="grid grid-cols-2 gap-3">
          {mobileOrdered.map((item, idx) => (
            <div key={item.id} className={idx === 0 ? "col-span-2" : ""}>
              {renderTile(item, idx === 0)}
            </div>
          ))}
        </div>

        <div className="rounded-[24px] bg-[#F5F8FC] p-5">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-[13px] font-semibold text-[#5B4BD6]">
            <Plus className="size-3.5" aria-hidden="true" />
            {activeItem.metric}
          </span>
          <h3 className="mt-3 font-heading text-lg font-bold text-slate-950">
            {activeItem.title}
          </h3>
          <p className="mt-1.5 text-base leading-relaxed text-slate-700">
            {activeItem.summary}
          </p>
        </div>
      </ScrollReveal>
    </section>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  CalendarPlus,
  CheckCircle2,
  Clock3,
  Lock,
  Pause,
  Play,
  ShieldAlert,
  UserRound,
} from "lucide-react";
import { cn } from "cn";
import { ScrollReveal } from "@/components/landing/scroll-reveal";

interface DemoService {
  id: string;
  name: string;
  category: string;
  durationMinutes: number;
  bufferMinutes: number;
  pricePhp: number;
  dentist: string;
  chair: string;
  chairTag: string;
}

const DEMO_SERVICES: DemoService[] = [
  {
    id: "prophylaxis",
    name: "Oral Prophylaxis",
    category: "Preventive",
    durationMinutes: 30,
    bufferMinutes: 15,
    pricePhp: 800,
    dentist: "Dr. Camille Reyes, DMD",
    chair: "Chair 1 · Hygiene Suite",
    chairTag: "General",
  },
  {
    id: "filling",
    name: "Composite Filling",
    category: "Restorative",
    durationMinutes: 45,
    bufferMinutes: 15,
    pricePhp: 1500,
    dentist: "Dr. Marco Lim, DMD",
    chair: "Chair 2 · Restorative Bay",
    chairTag: "General",
  },
  {
    id: "extraction",
    name: "Simple Extraction",
    category: "Oral Surgery",
    durationMinutes: 45,
    bufferMinutes: 15,
    pricePhp: 1200,
    dentist: "Dr. Angela Torres, DMD",
    chair: "Chair 3 · Surgery Suite",
    chairTag: "Surgery",
  },
  {
    id: "root-canal",
    name: "Root Canal Therapy",
    category: "Endodontics",
    durationMinutes: 90,
    bufferMinutes: 15,
    pricePhp: 6000,
    dentist: "Dr. Marco Lim, DMD",
    chair: "Chair 3 · Endodontic Suite",
    chairTag: "Endo + X-Ray",
  },
];

const TIME_SLOTS = ["09:00 AM", "10:30 AM", "01:30 PM", "03:00 PM"] as const;

const BOOKING_STAGES = [
  {
    title: "Select Dental Procedure",
    detail:
      "Patients browse transparent PHP pricing, procedure duration, and required chair tags.",
  },
  {
    title: "Dual-Resource Slot Match",
    detail:
      "Smile intersects dentist shifts, breaks, compatible chairs, and sterilization buffers live.",
  },
  {
    title: "5-Minute ACID Slot Hold",
    detail:
      "Clicking a slot locks the Dentist + Chair pair while medical intake and family dependents are added.",
  },
  {
    title: "Instant Confirmation & Recall",
    detail:
      "Exports .ICS calendar invites, emails confirmations, and queues 6-month hygiene reminders.",
  },
];

function formatCountdown(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function InteractiveSchedulerPreview() {
  const [selectedServiceId, setSelectedServiceId] = useState<string>(
    DEMO_SERVICES[0].id
  );
  const [selectedSlot, setSelectedSlot] = useState<string>(TIME_SLOTS[0]);
  const [secondsLeft, setSecondsLeft] = useState<number>(300);
  const [isRunning, setIsRunning] = useState<boolean>(true);

  const service =
    DEMO_SERVICES.find((item) => item.id === selectedServiceId) ??
    DEMO_SERVICES[0];

  useEffect(() => {
    if (!isRunning) return;
    const timer = window.setInterval(() => {
      setSecondsLeft((prev) => (prev <= 1 ? 300 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isRunning]);

  const handleSelectService = (id: string) => {
    setSelectedServiceId(id);
    setSecondsLeft(300);
  };

  const handleSelectSlot = (slot: string) => {
    setSelectedSlot(slot);
    setSecondsLeft(300);
  };

  const totalBlock = service.durationMinutes + service.bufferMinutes;

  return (
    <section
      id="live-preview"
      className="mx-auto w-full max-w-[1280px] px-4 py-16 sm:px-6 lg:px-8 lg:py-24"
    >
      <div className="rounded-[32px] bg-[#F4F8FC] p-6 sm:p-10 lg:p-14">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:items-center lg:gap-12">
          {/* Left Narrative & 4-Step Journey */}
          <ScrollReveal className="lg:col-span-5">
            <h2 className="font-heading text-3xl leading-[1.12] font-bold tracking-[-0.03em] text-slate-950 sm:text-4xl">
              Test how Smile stops
              <br />
              double-bookings
            </h2>

            <p className="mt-4 max-w-[52ch] text-base leading-relaxed text-slate-700">
              Generic booking calendars only check a doctor&apos;s clock. Smile
              locks both the dentist and an eligible operatory chair with built-in
              sterilization turnover time.
            </p>

            <ol className="mt-8 space-y-4">
              {BOOKING_STAGES.map((stage) => (
                <li key={stage.title} className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-[#6C5CE7] text-white"
                  >
                    <CheckCircle2 className="size-3.5" />
                  </span>
                  <div>
                    <p className="font-heading text-base font-bold text-slate-950">
                      {stage.title}
                    </p>
                    <p className="mt-0.5 text-sm leading-relaxed text-slate-700">
                      {stage.detail}
                    </p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="mt-8">
              <Link
                href="/clinics"
                className="inline-flex h-12 items-center gap-2 rounded-full bg-slate-950 px-6 text-sm font-semibold text-white transition-colors hover:bg-[#6C5CE7]"
              >
                <span>Try a Real Clinic Portal</span>
                <ArrowUpRight className="size-4" aria-hidden="true" />
              </Link>
            </div>
          </ScrollReveal>

          {/* Right Live Interactive Booking Engine Preview (data-ui) */}
          <ScrollReveal delayMs={100} className="lg:col-span-7">
            <div
              data-ui="live-slot-lock-simulator"
              className="rounded-[28px] bg-white p-5 sm:p-7"
            >
              {/* Top Simulator Status Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
                <div>
                  <p className="font-heading text-lg font-bold text-slate-950">
                    Live Slot &amp; Chair Matcher
                  </p>
                  <p className="text-sm text-slate-600">
                    Pick a procedure and time to inspect the locked resource pair
                  </p>
                </div>

                <div className="inline-flex items-center gap-2 rounded-full bg-[#EFEBFF] px-3.5 py-1.5 text-[13px] font-semibold text-[#4F3EC7]">
                  <Lock className="size-3.5" aria-hidden="true" />
                  <span className="tabular-nums">
                    Hold: {formatCountdown(secondsLeft)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsRunning((prev) => !prev)}
                    aria-label={isRunning ? "Pause countdown" : "Resume countdown"}
                    className="inline-flex size-6 items-center justify-center rounded-full bg-white text-[#4F3EC7] transition-colors hover:bg-[#6C5CE7] hover:text-white cursor-pointer"
                  >
                    {isRunning ? (
                      <Pause className="size-3" aria-hidden="true" />
                    ) : (
                      <Play className="size-3" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>

              {/* Procedure Selector */}
              <div className="mt-3">
                <p className="text-[13px] font-semibold text-slate-700">
                  1. Select procedure (from Smile default catalog)
                </p>
                <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {DEMO_SERVICES.map((item) => {
                    const active = item.id === service.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleSelectService(item.id)}
                        aria-pressed={active}
                        className={cn(
                          "flex items-center justify-between rounded-2xl px-4 py-3 text-left transition-colors cursor-pointer",
                          active
                            ? "bg-[#EFEBFF] ring-2 ring-[#6C5CE7]/40"
                            : "bg-[#F7F9FC] hover:bg-[#EEF7FD]"
                        )}
                      >
                        <div className="min-w-0 pr-2">
                          <p className="truncate font-heading text-sm font-bold text-slate-950">
                            {item.name}
                          </p>
                          <p className="text-[13px] text-slate-700">
                            {item.durationMinutes}m + {item.bufferMinutes}m
                            buffer
                          </p>
                        </div>
                        <span className="shrink-0 rounded-full bg-white px-3 py-1 text-[13px] font-bold tabular-nums text-slate-950">
                          ₱{item.pricePhp.toLocaleString()}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Time Slot Picker */}
              <div className="mt-5">
                <p className="text-[13px] font-semibold text-slate-700">
                  2. Choose available start time (Asia/Manila)
                </p>
                <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {TIME_SLOTS.map((slot) => {
                    const active = slot === selectedSlot;
                    return (
                      <button
                        key={slot}
                        type="button"
                        onClick={() => handleSelectSlot(slot)}
                        aria-pressed={active}
                        className={cn(
                          "h-10 rounded-full text-[13px] font-semibold tabular-nums transition-colors cursor-pointer",
                          active
                            ? "bg-slate-950 text-white"
                            : "bg-[#F5F7FA] text-slate-800 hover:bg-[#EAF1F8]"
                        )}
                      >
                        {slot}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Live ACID Resource Allocation Readout */}
              <div className="mt-6 rounded-2xl bg-[#EEF7FD] p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-950">
                    <CalendarPlus
                      className="size-4 text-[#5B4BD6]"
                      aria-hidden="true"
                    />
                    Assigned Dual-Resource Pair · {selectedSlot}
                  </span>
                  <span className="rounded-full bg-white px-3 py-1 text-[13px] font-semibold text-[#4F3EC7]">
                    {totalBlock} mins reserved total
                  </span>
                </div>

                <div className="mt-3.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-xl bg-white p-3.5">
                    <div className="flex items-center gap-2 text-[13px] text-slate-600">
                      <UserRound
                        className="size-3.5 text-[#5B4BD6]"
                        aria-hidden="true"
                      />
                      <span>Assigned Dentist</span>
                    </div>
                    <p className="mt-1 font-heading text-sm font-bold text-slate-950">
                      {service.dentist}
                    </p>
                  </div>

                  <div className="rounded-xl bg-white p-3.5">
                    <div className="flex items-center gap-2 text-[13px] text-slate-600">
                      <Clock3
                        className="size-3.5 text-[#5B4BD6]"
                        aria-hidden="true"
                      />
                      <span>Matched Operatory Chair</span>
                    </div>
                    <p className="mt-1 font-heading text-sm font-bold text-slate-950">
                      {service.chair}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white px-3.5 py-2.5 text-[13px] text-slate-800">
                  <span className="inline-flex items-center gap-1.5">
                    <ShieldAlert
                      className="size-4 text-rose-600"
                      aria-hidden="true"
                    />
                    <span>
                      Chair tag verified: <strong>{service.chairTag}</strong> ·{" "}
                      <strong>{service.bufferMinutes}m</strong> sterilization
                      protected
                    </span>
                  </span>
                  <Link
                    href="/clinics"
                    className="font-semibold text-[#4F3EC7] hover:underline"
                  >
                    Book live →
                  </Link>
                </div>
              </div>
            </div>
          </ScrollReveal>
        </div>
      </div>
    </section>
  );
}

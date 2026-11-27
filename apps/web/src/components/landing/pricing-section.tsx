"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, CreditCard } from "lucide-react";
import { cn } from "cn";
import { ScrollReveal } from "@/components/landing/scroll-reveal";

interface PricingPlan {
  code: string;
  name: string;
  tagline: string;
  monthlyPricePhp: number;
  annualPricePhp: number;
  highlighted?: boolean;
  ctaLabel: string;
  ctaHref: string;
  features: string[];
}

const SMILE_PLANS: PricingPlan[] = [
  {
    code: "trial",
    name: "Free 14-Day Trial",
    tagline: "Evaluate Smile in your live clinic before committing.",
    monthlyPricePhp: 0,
    annualPricePhp: 0,
    ctaLabel: "Start Free Trial",
    ctaHref: "/sign-up",
    features: [
      "1 Dentist & 1 Operatory Chair",
      "Up to 50 appointments / month",
      "Interactive 32-Tooth SVG Odontogram",
      "5-Minute ACID Slot Locking",
      "Branded /c/[clinic-slug] Booking Portal",
    ],
  },
  {
    code: "starter",
    name: "Smile Starter",
    tagline: "Built for solo and two-chair neighborhood practices.",
    monthlyPricePhp: 1499,
    annualPricePhp: 14990,
    ctaLabel: "Choose Starter",
    ctaHref: "/sign-up",
    features: [
      "Up to 2 Dentists & 2 Operatory Chairs",
      "Up to 300 appointments / month",
      "150 MB Compressed X-Ray & Photo Vault",
      "400 Automated Patient Emails / month",
      "Front-Desk Master Calendar & Kanban",
    ],
  },
  {
    code: "pro",
    name: "Smile Pro Clinic",
    tagline: "Full automation for growing multi-dentist practices.",
    monthlyPricePhp: 2999,
    annualPricePhp: 29990,
    highlighted: true,
    ctaLabel: "Get Smile Pro",
    ctaHref: "/sign-up",
    features: [
      "Up to 8 Dentists & 8 Operatory Chairs",
      "Up to 1,500 appointments / month",
      "400 MB X-Ray Vault & 1,000 Emails / mo",
      "Automated Waitlist Cancellation Blasts",
      "6-Month Hygiene Recall & Custom Branding",
    ],
  },
];

export function PricingSection() {
  const [annual, setAnnual] = useState<boolean>(false);

  return (
    <section
      id="pricing"
      className="mx-auto w-full max-w-[1280px] px-4 py-16 sm:px-6 lg:px-8 lg:py-24"
    >
      {/* Header + Billing Toggle */}
      <ScrollReveal className="flex flex-col items-start justify-between gap-6 lg:flex-row lg:items-end">
        <div className="max-w-xl">
          <h2 className="font-heading text-3xl leading-[1.12] font-bold tracking-[-0.03em] text-slate-950 sm:text-4xl lg:text-[2.65rem]">
            Transparent plans for
            <br />
            Philippine dental clinics
          </h2>
          <p className="mt-3 max-w-[54ch] text-base leading-relaxed text-slate-700">
            Zero payment-gateway markups. Pay seamlessly via GCash, Maya, Bank
            Transfer, or Card with instant receipt verification.
          </p>
        </div>

        {/* Monthly / Annual Pill Switch */}
        <div
          role="group"
          aria-label="Billing interval"
          className="inline-flex items-center rounded-full bg-[#F4F6FA] p-1"
        >
          <button
            type="button"
            onClick={() => setAnnual(false)}
            aria-pressed={!annual}
            className={cn(
              "rounded-full px-5 py-2 text-[13px] font-semibold transition-colors cursor-pointer",
              !annual
                ? "bg-slate-950 text-white"
                : "text-slate-700 hover:text-slate-950"
            )}
          >
            Monthly
          </button>
          <button
            type="button"
            onClick={() => setAnnual(true)}
            aria-pressed={annual}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-5 py-2 text-[13px] font-semibold transition-colors cursor-pointer",
              annual
                ? "bg-slate-950 text-white"
                : "text-slate-700 hover:text-slate-950"
            )}
          >
            <span>Annual</span>
            <span
              className={cn(
                "rounded-full px-2.5 py-0.5 text-xs font-bold",
                annual
                  ? "bg-[#6C5CE7] text-white"
                  : "bg-[#E6E2FF] text-[#4332B8]"
              )}
            >
              2 mos free
            </span>
          </button>
        </div>
      </ScrollReveal>

      {/* Pricing Cards Grid */}
      <ScrollReveal
        delayMs={90}
        className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3"
      >
        {SMILE_PLANS.map((plan) => {
          const displayPrice = annual
            ? plan.annualPricePhp
            : plan.monthlyPricePhp;
          const periodLabel =
            displayPrice === 0 ? "for 14 days" : annual ? "/ year" : "/ month";

          return (
            <div
              key={plan.code}
              className={cn(
                "flex flex-col justify-between rounded-[28px] p-6 sm:p-8 transition-transform duration-200 hover:-translate-y-1",
                plan.highlighted
                  ? "bg-[#6C5CE7] text-white"
                  : "bg-[#F4F8FC] text-slate-950"
              )}
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-heading text-xl font-bold tracking-tight">
                    {plan.name}
                  </h3>
                  {plan.highlighted ? (
                    <span className="rounded-full bg-white/22 px-3 py-1 text-[13px] font-semibold text-white">
                      Most Popular
                    </span>
                  ) : null}
                </div>

                <p
                  className={cn(
                    "mt-2 text-base leading-relaxed",
                    plan.highlighted ? "text-white/92" : "text-slate-700"
                  )}
                >
                  {plan.tagline}
                </p>

                <div className="mt-6 flex items-baseline gap-1.5">
                  <span className="font-heading text-4xl font-bold tabular-nums tracking-tight">
                    ₱{displayPrice.toLocaleString()}
                  </span>
                  <span
                    className={cn(
                      "text-sm font-medium",
                      plan.highlighted ? "text-white/90" : "text-slate-600"
                    )}
                  >
                    {periodLabel}
                  </span>
                </div>

                <ul className="mt-7 space-y-3">
                  {plan.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-2.5 text-sm sm:text-[15px]"
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full",
                          plan.highlighted
                            ? "bg-white/22 text-white"
                            : "bg-white text-[#5B4BD6]"
                        )}
                      >
                        <Check className="size-3" strokeWidth={2.5} />
                      </span>
                      <span
                        className={
                          plan.highlighted ? "text-white" : "text-slate-800"
                        }
                      >
                        {feature}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-8">
                <Link
                  href={plan.ctaHref}
                  className={cn(
                    "inline-flex h-12 w-full items-center justify-center gap-2 rounded-full text-sm font-semibold transition-colors",
                    plan.highlighted
                      ? "bg-white text-slate-950 hover:bg-[#F1EEFF]"
                      : "bg-slate-950 text-white hover:bg-[#6C5CE7]"
                  )}
                >
                  <span>{plan.ctaLabel}</span>
                  <ArrowUpRight className="size-4" aria-hidden="true" />
                </Link>
              </div>
            </div>
          );
        })}
      </ScrollReveal>

      {/* Payment Rails Strip */}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 rounded-2xl bg-[#F5F7FA] px-5 py-3.5 text-[13px] font-medium text-slate-700">
        <span className="inline-flex items-center gap-1.5 font-semibold text-slate-950">
          <CreditCard className="size-4 text-[#5B4BD6]" aria-hidden="true" />
          Supported local payment rails:
        </span>
        <span>GCash</span>
        <span>·</span>
        <span>Maya</span>
        <span>·</span>
        <span>Philippine Bank Transfer</span>
        <span>·</span>
        <span>Card &amp; Official Invoice Ledger</span>
      </div>
    </section>
  );
}

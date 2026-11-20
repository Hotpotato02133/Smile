"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { Show, UserButton } from "@clerk/nextjs";
import { ArrowUpRight, Menu } from "lucide-react";
import { useEnvConfig } from "@/components/providers/app-providers";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { SmileLogo } from "@/components/landing/smile-logo";

const LEFT_NAV_ITEMS = [
  { label: "Home", href: "#top", active: true },
  { label: "Capabilities", href: "#capabilities", active: false },
  { label: "Workflows", href: "#workflows", active: false },
];

const RIGHT_NAV_ITEMS = [
  { label: "Live Engine", href: "#live-preview" },
  { label: "Pricing", href: "#pricing" },
];

const ALL_MOBILE_ITEMS = [
  { label: "Overview", href: "#top" },
  { label: "Platform Capabilities", href: "#capabilities" },
  { label: "Clinic Workflows", href: "#workflows" },
  { label: "Live Scheduling Engine", href: "#live-preview" },
  { label: "Plans & Pricing", href: "#pricing" },
  { label: "FAQ", href: "#faq" },
];

export function LandingNavbar() {
  const { hasClerk } = useEnvConfig();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 w-full bg-white/94 backdrop-blur-md">
      <div className="mx-auto flex h-[74px] w-full max-w-[1280px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        {/* Desktop Left Pill Nav */}
        <nav
          aria-label="Primary sections"
          className="hidden lg:flex items-center gap-2"
        >
          {LEFT_NAV_ITEMS.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="inline-flex items-center gap-2 rounded-full bg-[#F5F7FA] px-4 py-2 text-[13.5px] font-medium text-slate-700 transition-colors hover:bg-[#EAF1F8] hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6C5CE7]"
            >
              {item.active ? (
                <span
                  className="size-1.5 rounded-full bg-slate-950"
                  aria-hidden="true"
                />
              ) : null}
              <span>{item.label}</span>
            </a>
          ))}
        </nav>

        {/* Brand Center Anchor (Left on Mobile, Centered on Desktop) */}
        <Link
          href="/"
          aria-label="Smile Home"
          className="inline-flex items-center rounded-full bg-[#F5F7FA] px-4 py-2 transition-colors hover:bg-[#ECEAFD] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6C5CE7] lg:px-5"
        >
          <SmileLogo />
        </Link>

        {/* Desktop Right Nav + Auth/CTA */}
        <div className="hidden lg:flex items-center gap-2">
          {RIGHT_NAV_ITEMS.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="inline-flex items-center rounded-full bg-[#F5F7FA] px-4 py-2 text-[13.5px] font-medium text-slate-700 transition-colors hover:bg-[#EAF1F8] hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6C5CE7]"
            >
              {item.label}
            </a>
          ))}

          {hasClerk ? (
            <Suspense
              fallback={
                <Link
                  href="/clinics"
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#6C5CE7] px-5 py-2 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#5B4BD6]"
                >
                  <span>Book a Visit</span>
                  <ArrowUpRight className="size-3.5" aria-hidden="true" />
                </Link>
              }
            >
              <Show when="signed-out">
                <Link
                  href="/sign-in"
                  className="inline-flex items-center rounded-full bg-[#F5F7FA] px-4 py-2 text-[13.5px] font-medium text-slate-700 transition-colors hover:bg-[#EAF1F8] hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6C5CE7]"
                >
                  Sign In
                </Link>
                <Link
                  href="/clinics"
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#6C5CE7] px-5 py-2 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#5B4BD6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6C5CE7]"
                >
                  <span>Book a Visit</span>
                  <ArrowUpRight className="size-3.5" aria-hidden="true" />
                </Link>
              </Show>
              <Show when="signed-in">
                <Link
                  href="/post-login"
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#6C5CE7] px-5 py-2 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#5B4BD6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6C5CE7]"
                >
                  <span>Dashboard</span>
                  <ArrowUpRight className="size-3.5" aria-hidden="true" />
                </Link>
                <div className="pl-1">
                  <UserButton />
                </div>
              </Show>
            </Suspense>
          ) : (
            <>
              <Link
                href="/sign-in"
                className="inline-flex items-center rounded-full bg-[#F5F7FA] px-4 py-2 text-[13.5px] font-medium text-slate-700 transition-colors hover:bg-[#EAF1F8] hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6C5CE7]"
              >
                Sign In
              </Link>
              <Link
                href="/clinics"
                className="inline-flex items-center gap-1.5 rounded-full bg-[#6C5CE7] px-5 py-2 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#5B4BD6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6C5CE7]"
              >
                <span>Book a Visit</span>
                <ArrowUpRight className="size-3.5" aria-hidden="true" />
              </Link>
            </>
          )}
        </div>

        {/* Mobile Quick Action + Sheet Trigger */}
        <div className="flex items-center gap-2 lg:hidden">
          <Link
            href="/clinics"
            className="inline-flex items-center gap-1 rounded-full bg-[#6C5CE7] px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#5B4BD6]"
          >
            <span>Book</span>
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </Link>

          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger
              aria-label="Open navigation menu"
              className="inline-flex size-10 items-center justify-center rounded-full bg-[#F5F7FA] text-slate-800 transition-colors hover:bg-[#EAF1F8] cursor-pointer"
            >
              <Menu className="size-5" aria-hidden="true" />
            </SheetTrigger>
            <SheetContent side="right" className="w-[86vw] max-w-sm bg-white p-0">
              <SheetHeader className="border-b border-slate-100 px-6 py-5 text-left">
                <SheetTitle>
                  <SmileLogo />
                </SheetTitle>
              </SheetHeader>
              <div className="flex flex-1 flex-col justify-between p-6">
                <nav aria-label="Mobile navigation" className="flex flex-col gap-1.5">
                  {ALL_MOBILE_ITEMS.map((item) => (
                    <a
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      className="flex items-center justify-between rounded-2xl px-4 py-3 text-[15px] font-medium text-slate-800 transition-colors hover:bg-[#F5F7FA]"
                    >
                      <span>{item.label}</span>
                      <ArrowUpRight className="size-4 text-slate-400" aria-hidden="true" />
                    </a>
                  ))}
                </nav>

                <div className="mt-8 flex flex-col gap-2.5 border-t border-slate-100 pt-6">
                  <Link
                    href="/clinics"
                    onClick={() => setMobileOpen(false)}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-[#6C5CE7] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#5B4BD6]"
                  >
                    <span>Browse Dental Clinics</span>
                    <ArrowUpRight className="size-4" aria-hidden="true" />
                  </Link>
                  {hasClerk ? (
                    <Suspense fallback={null}>
                      <Show when="signed-out">
                        <div className="grid grid-cols-2 gap-2">
                          <Link
                            href="/sign-in"
                            onClick={() => setMobileOpen(false)}
                            className="inline-flex h-11 items-center justify-center rounded-full bg-[#F5F7FA] px-4 text-sm font-semibold text-slate-900 transition-colors hover:bg-[#EAF1F8]"
                          >
                            Sign In
                          </Link>
                          <Link
                            href="/sign-up"
                            onClick={() => setMobileOpen(false)}
                            className="inline-flex h-11 items-center justify-center rounded-full border border-slate-200 px-4 text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-50"
                          >
                            Create Account
                          </Link>
                        </div>
                      </Show>
                      <Show when="signed-in">
                        <Link
                          href="/post-login"
                          onClick={() => setMobileOpen(false)}
                          className="inline-flex h-11 items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-semibold text-white"
                        >
                          Go to Dashboard
                        </Link>
                      </Show>
                    </Suspense>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <Link
                        href="/sign-in"
                        onClick={() => setMobileOpen(false)}
                        className="inline-flex h-11 items-center justify-center rounded-full bg-[#F5F7FA] px-4 text-sm font-semibold text-slate-900"
                      >
                        Sign In
                      </Link>
                      <Link
                        href="/sign-up"
                        onClick={() => setMobileOpen(false)}
                        className="inline-flex h-11 items-center justify-center rounded-full border border-slate-200 px-4 text-sm font-semibold text-slate-900"
                      >
                        Create Account
                      </Link>
                    </div>
                  )}
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}

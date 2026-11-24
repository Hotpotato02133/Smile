"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { ClerkLoaded, ClerkLoading, Show, UserButton } from "@clerk/nextjs";
import { ArrowUpRight, Menu } from "lucide-react";
import { cn } from "cn";
import { useEnvConfig } from "@/components/providers/app-providers";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { SmileLogo } from "@/components/landing/smile-logo";

interface NavItem {
  id: string;
  label: string;
  href: string;
  description: string;
}

const NAV_ITEMS: NavItem[] = [
  {
    id: "capabilities",
    label: "Capabilities",
    href: "#capabilities",
    description: "Dual-resource sync, 32-tooth chart & X-ray vault",
  },
  {
    id: "workflows",
    label: "Workflows",
    href: "#workflows",
    description: "Patient, chairside dentist & front-desk views",
  },
  {
    id: "live-preview",
    label: "Live Engine",
    href: "#live-preview",
    description: "Interactive 5-minute slot lock & chair matcher",
  },
  {
    id: "pricing",
    label: "Pricing",
    href: "#pricing",
    description: "Transparent PHP plans via GCash, Maya & bank",
  },
  {
    id: "faq",
    label: "FAQ",
    href: "#faq",
    description: "Tenant isolation, grace periods & walk-ins",
  },
];

function PrimaryCtaPill({
  href,
  label,
  compact = false,
  className,
  onClick,
}: {
  href: string;
  label: string;
  compact?: boolean;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        "group inline-flex items-center justify-center rounded-full bg-slate-950 font-semibold text-white transition-colors duration-200 hover:bg-[#6C5CE7] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6C5CE7]",
        compact ? "h-10 gap-2 pl-4 pr-1.5 text-[13px]" : "h-10 gap-2.5 pl-4 pr-1.5 text-[13.5px]",
        className
      )}
    >
      <span>{label}</span>
      <span
        aria-hidden="true"
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-white text-slate-950 transition-transform duration-200 group-hover:scale-105 group-hover:text-[#5B4BD6]"
      >
        <ArrowUpRight className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      </span>
    </Link>
  );
}

export function LandingNavbar() {
  const { hasClerk } = useEnvConfig();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [activeSectionId, setActiveSectionId] = useState<string>("");

  // Track scroll state (compact sticky mode, reading progress bar, and deterministic scrollspy)
  useEffect(() => {
    let rafId = 0;

    const updateScroll = () => {
      rafId = 0;
      const scrollY = window.scrollY;
      setIsScrolled(scrollY > 24);

      const maxScroll =
        document.documentElement.scrollHeight - window.innerHeight;
      if (maxScroll > 0) {
        setScrollProgress(Math.min(1, Math.max(0, scrollY / maxScroll)));
      } else {
        setScrollProgress(0);
      }

      if (scrollY < 160) {
        setActiveSectionId("");
        return;
      }

      const activationLine = Math.min(window.innerHeight * 0.34, 280);
      let currentId = "";

      for (const item of NAV_ITEMS) {
        const el = document.getElementById(item.id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= activationLine) {
          currentId = item.id;
        }
      }

      // If at the bottom of the page, highlight the final section
      if (maxScroll > 0 && scrollY >= maxScroll - 48) {
        currentId = NAV_ITEMS[NAV_ITEMS.length - 1].id;
      }

      setActiveSectionId(currentId);
    };

    const handleScroll = () => {
      if (rafId !== 0) return;
      rafId = window.requestAnimationFrame(updateScroll);
    };

    updateScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
      if (rafId !== 0) window.cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <header
      data-scrolled={isScrolled ? "true" : "false"}
      className={cn(
        "sticky top-0 z-40 w-full transition-[background-color] duration-200 ease-out",
        isScrolled ? "bg-[#F8FAFC]" : "bg-white"
      )}
    >
      {/* Keyboard Skip Link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-4 focus:z-50 focus:inline-flex focus:h-10 focus:items-center focus:rounded-full focus:bg-slate-950 focus:px-4 focus:text-sm focus:font-semibold focus:text-white focus:outline-2 focus:outline-offset-2 focus:outline-[#6C5CE7]"
      >
        Skip to content
      </a>

      <div
        className={cn(
          "mx-auto grid w-full max-w-[1280px] grid-cols-[auto_1fr] items-center gap-4 px-4 transition-[height] duration-200 ease-out sm:px-6 lg:grid-cols-[1fr_auto_1fr] lg:px-8",
          isScrolled ? "h-16" : "h-[76px]"
        )}
      >
        {/* Left: Brand Wordmark */}
        <div className="flex items-center justify-self-start">
          <Link
            href="#top"
            aria-label="Smile — Back to top"
            onClick={() => setActiveSectionId("")}
            className="group inline-flex min-h-11 items-center rounded-full pr-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6C5CE7]"
          >
            <SmileLogo markClassName="transition-transform duration-200 group-hover:scale-105" />
          </Link>
        </div>

        {/* Center: Desktop Primary Navigation */}
        <nav
          aria-label="Primary"
          className="hidden items-center justify-center gap-1 lg:flex"
        >
          {NAV_ITEMS.map((item) => {
            const isActive = activeSectionId === item.id;
            return (
              <a
                key={item.id}
                href={item.href}
                data-active={isActive ? "true" : "false"}
                aria-current={isActive ? "location" : undefined}
                onClick={() => setActiveSectionId(item.id)}
                className={cn(
                  "smile-nav-link inline-flex h-10 items-center rounded-full px-3.5 text-[14px] font-medium whitespace-nowrap transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6C5CE7]",
                  isActive
                    ? "text-slate-950"
                    : "text-slate-700 hover:bg-[#EEF3F8] hover:text-slate-950"
                )}
              >
                {item.label}
              </a>
            );
          })}
        </nav>

        {/* Right: Desktop Auth + Primary CTA */}
        <div className="hidden items-center justify-self-end gap-2 lg:flex">
          {hasClerk ? (
            <Suspense
              fallback={
                <>
                  <Link
                    href="/sign-in"
                    className="inline-flex h-10 items-center rounded-full px-4 text-[14px] font-medium text-slate-700 whitespace-nowrap transition-colors duration-150 hover:bg-[#EEF3F8] hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6C5CE7]"
                  >
                    Sign In
                  </Link>
                  <PrimaryCtaPill href="/clinics" label="Book a Visit" />
                </>
              }
            >
              <ClerkLoading>
                <Link
                  href="/sign-in"
                  className="inline-flex h-10 items-center rounded-full px-4 text-[14px] font-medium text-slate-700 whitespace-nowrap transition-colors duration-150 hover:bg-[#EEF3F8] hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6C5CE7]"
                >
                  Sign In
                </Link>
                <PrimaryCtaPill href="/clinics" label="Book a Visit" />
              </ClerkLoading>
              <ClerkLoaded>
                <Show when="signed-out">
                  <Link
                    href="/sign-in"
                    className="inline-flex h-10 items-center rounded-full px-4 text-[14px] font-medium text-slate-700 whitespace-nowrap transition-colors duration-150 hover:bg-[#EEF3F8] hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6C5CE7]"
                  >
                    Sign In
                  </Link>
                  <PrimaryCtaPill href="/clinics" label="Book a Visit" />
                </Show>
                <Show when="signed-in">
                  <PrimaryCtaPill href="/post-login" label="Dashboard" />
                  <div className="flex items-center pl-1">
                    <UserButton />
                  </div>
                </Show>
              </ClerkLoaded>
            </Suspense>
          ) : (
            <>
              <Link
                href="/sign-in"
                className="inline-flex h-10 items-center rounded-full px-4 text-[14px] font-medium text-slate-700 whitespace-nowrap transition-colors duration-150 hover:bg-[#EEF3F8] hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6C5CE7]"
              >
                Sign In
              </Link>
              <PrimaryCtaPill href="/clinics" label="Book a Visit" />
            </>
          )}
        </div>

        {/* Mobile & Tablet Right Cluster */}
        <div className="flex items-center justify-self-end gap-2 lg:hidden">
          {hasClerk ? (
            <Suspense
              fallback={
                <>
                  <PrimaryCtaPill
                    href="/clinics"
                    label="Book a Visit"
                    compact
                    className="hidden sm:inline-flex"
                  />
                  <PrimaryCtaPill
                    href="/clinics"
                    label="Book"
                    compact
                    className="sm:hidden"
                  />
                </>
              }
            >
              <ClerkLoading>
                <Link
                  href="/sign-in"
                  className="hidden h-10 items-center rounded-full px-3.5 text-sm font-medium text-slate-700 transition-colors hover:bg-[#EEF3F8] hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6C5CE7] md:inline-flex"
                >
                  Sign In
                </Link>
                <PrimaryCtaPill
                  href="/clinics"
                  label="Book a Visit"
                  compact
                  className="hidden sm:inline-flex"
                />
                <PrimaryCtaPill
                  href="/clinics"
                  label="Book"
                  compact
                  className="sm:hidden"
                />
              </ClerkLoading>
              <ClerkLoaded>
                <Show when="signed-out">
                  <Link
                    href="/sign-in"
                    className="hidden h-10 items-center rounded-full px-3.5 text-sm font-medium text-slate-700 transition-colors hover:bg-[#EEF3F8] hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6C5CE7] md:inline-flex"
                  >
                    Sign In
                  </Link>
                  <PrimaryCtaPill
                    href="/clinics"
                    label="Book a Visit"
                    compact
                    className="hidden sm:inline-flex"
                  />
                  <PrimaryCtaPill
                    href="/clinics"
                    label="Book"
                    compact
                    className="sm:hidden"
                  />
                </Show>
                <Show when="signed-in">
                  <PrimaryCtaPill
                    href="/post-login"
                    label="Dashboard"
                    compact
                  />
                  <div className="hidden items-center sm:flex">
                    <UserButton />
                  </div>
                </Show>
              </ClerkLoaded>
            </Suspense>
          ) : (
            <>
              <Link
                href="/sign-in"
                className="hidden h-10 items-center rounded-full px-3.5 text-sm font-medium text-slate-700 transition-colors hover:bg-[#EEF3F8] hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6C5CE7] md:inline-flex"
              >
                Sign In
              </Link>
              <PrimaryCtaPill
                href="/clinics"
                label="Book a Visit"
                compact
                className="hidden sm:inline-flex"
              />
              <PrimaryCtaPill
                href="/clinics"
                label="Book"
                compact
                className="sm:hidden"
              />
            </>
          )}

          {/* Responsive Drawer Trigger (44px+ Touch Target) */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger
              aria-label="Open navigation menu"
              className="inline-flex size-11 items-center justify-center gap-2 rounded-full bg-[#F1F5F9] text-sm font-semibold text-slate-950 transition-colors duration-150 hover:bg-[#EFEBFF] hover:text-[#5B4BD6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6C5CE7] cursor-pointer sm:h-11 sm:w-auto sm:px-4"
            >
              <Menu className="size-4.5 shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline">Menu</span>
            </SheetTrigger>

            <SheetContent
              side="right"
              className="w-[88dvw] max-w-[380px] bg-white p-0 gap-0"
            >
              <SheetHeader className="px-6 pt-6 pb-4 text-left">
                <SheetTitle>
                  <SmileLogo />
                </SheetTitle>
                <SheetDescription className="mt-1 text-sm text-slate-600">
                  Dual-resource dental scheduling &amp; clinical charting
                </SheetDescription>
              </SheetHeader>

              <div className="flex flex-1 flex-col justify-between overflow-y-auto px-4 pb-6 pt-2">
                {/* Editorial Section Index */}
                <nav
                  aria-label="Mobile navigation"
                  className="flex flex-col gap-1.5"
                >
                  {NAV_ITEMS.map((item) => {
                    const isActive = activeSectionId === item.id;
                    return (
                      <a
                        key={item.id}
                        href={item.href}
                        aria-current={isActive ? "location" : undefined}
                        onClick={() => {
                          setActiveSectionId(item.id);
                          setMobileOpen(false);
                        }}
                        className={cn(
                          "group flex min-h-14 items-center justify-between gap-3 rounded-2xl px-4 py-3 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6C5CE7]",
                          isActive
                            ? "bg-[#EFEBFF] text-slate-950"
                            : "bg-transparent text-slate-900 hover:bg-[#F4F8FC]"
                        )}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            {isActive ? (
                              <span
                                aria-hidden="true"
                                className="size-2 shrink-0 rounded-full bg-[#6C5CE7]"
                              />
                            ) : null}
                            <span
                              className={cn(
                                "font-heading text-[15px] tracking-tight",
                                isActive
                                  ? "font-bold text-[#4F3EC7]"
                                  : "font-semibold text-slate-950"
                              )}
                            >
                              {item.label}
                            </span>
                          </div>
                          <p className="mt-0.5 truncate text-[13px] text-slate-600">
                            {item.description}
                          </p>
                        </div>
                        <span
                          aria-hidden="true"
                          className={cn(
                            "inline-flex size-8 shrink-0 items-center justify-center rounded-full transition-colors",
                            isActive
                              ? "bg-white text-[#5B4BD6]"
                              : "bg-[#F4F6FA] text-slate-600 group-hover:bg-white group-hover:text-slate-950"
                          )}
                        >
                          <ArrowUpRight className="size-4" />
                        </span>
                      </a>
                    );
                  })}
                </nav>

                {/* Bottom Tonal Action Dock */}
                <div className="mt-6 flex flex-col gap-2.5 rounded-[24px] bg-[#F4F8FC] p-4">
                  <Link
                    href="/clinics"
                    onClick={() => setMobileOpen(false)}
                    className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#6C5CE7] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#5B4BD6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6C5CE7]"
                  >
                    <span>Browse Dental Clinics</span>
                    <ArrowUpRight className="size-4" aria-hidden="true" />
                  </Link>

                  {hasClerk ? (
                    <Suspense fallback={null}>
                      <ClerkLoading>
                        <div className="grid grid-cols-2 gap-2">
                          <Link
                            href="/sign-in"
                            onClick={() => setMobileOpen(false)}
                            className="inline-flex h-11 items-center justify-center rounded-full bg-white px-4 text-sm font-semibold text-slate-950 transition-colors hover:bg-[#EFEBFF] hover:text-[#4F3EC7]"
                          >
                            Sign In
                          </Link>
                          <Link
                            href="/sign-up"
                            onClick={() => setMobileOpen(false)}
                            className="inline-flex h-11 items-center justify-center rounded-full bg-slate-950 px-4 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
                          >
                            Sign Up
                          </Link>
                        </div>
                      </ClerkLoading>
                      <ClerkLoaded>
                        <Show when="signed-out">
                          <div className="grid grid-cols-2 gap-2">
                            <Link
                              href="/sign-in"
                              onClick={() => setMobileOpen(false)}
                              className="inline-flex h-11 items-center justify-center rounded-full bg-white px-4 text-sm font-semibold text-slate-950 transition-colors hover:bg-[#EFEBFF] hover:text-[#4F3EC7]"
                            >
                              Sign In
                            </Link>
                            <Link
                              href="/sign-up"
                              onClick={() => setMobileOpen(false)}
                              className="inline-flex h-11 items-center justify-center rounded-full bg-slate-950 px-4 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
                            >
                              Sign Up
                            </Link>
                          </div>
                        </Show>
                        <Show when="signed-in">
                          <div className="flex items-center justify-between gap-3 rounded-full bg-white px-4 py-2">
                            <Link
                              href="/post-login"
                              onClick={() => setMobileOpen(false)}
                              className="inline-flex h-9 flex-1 items-center justify-center rounded-full bg-slate-950 px-4 text-sm font-semibold text-white transition-colors hover:bg-[#6C5CE7]"
                            >
                              Go to Dashboard
                            </Link>
                            <UserButton />
                          </div>
                        </Show>
                      </ClerkLoaded>
                    </Suspense>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <Link
                        href="/sign-in"
                        onClick={() => setMobileOpen(false)}
                        className="inline-flex h-11 items-center justify-center rounded-full bg-white px-4 text-sm font-semibold text-slate-950 transition-colors hover:bg-[#EFEBFF] hover:text-[#4F3EC7]"
                      >
                        Sign In
                      </Link>
                      <Link
                        href="/sign-up"
                        onClick={() => setMobileOpen(false)}
                        className="inline-flex h-11 items-center justify-center rounded-full bg-slate-950 px-4 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
                      >
                        Sign Up
                      </Link>
                    </div>
                  )}
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* Scroll Reading Progress Track (Revealed only once scrolled) */}
      <div
        aria-hidden="true"
        className={cn(
          "h-[2px] w-full overflow-hidden bg-[#E6EDF5] transition-opacity duration-200",
          isScrolled ? "opacity-100" : "opacity-0"
        )}
      >
        <div
          className="h-full w-full origin-left bg-[#6C5CE7]"
          style={{ transform: `scaleX(${scrollProgress})` }}
        />
      </div>
    </header>
  );
}

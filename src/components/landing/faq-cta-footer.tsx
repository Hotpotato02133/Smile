import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, ChevronDown, ShieldCheck } from "lucide-react";
import { SmileLogo } from "@/components/landing/smile-logo";
import { ScrollReveal } from "@/components/landing/scroll-reveal";

const FAQ_ITEMS = [
  {
    question: "How does Smile guarantee zero double-bookings?",
    answer:
      "Every appointment creation and reschedule runs inside a single atomic transaction checking both the assigned dentist's shift and the operatory chair—plus your clinic's sterilization buffer minutes—before committing.",
  },
  {
    question: "Can patients book appointments for children or senior parents?",
    answer:
      "Yes. Patients can sign in once and book either for themselves or linked family dependents under a single account, complete with individualized allergies, medical conditions, and dental anxiety flags.",
  },
  {
    question: "How is each dental clinic's clinical data isolated?",
    answer:
      "Smile enforces strict multi-tenant clinicId indexing on every operational query and mutation. Patient charts, medical alerts, odontogram records, and X-rays are never exposed to other clinics or public routes.",
  },
  {
    question: "What happens if a clinic subscription lapses?",
    answer:
      "Clinics receive a 3-day grace period with a renewal notice. If suspended, online bookings pause automatically while clinic staff keep read-only access to legal and clinical patient charts.",
  },
  {
    question: "Do walk-in patients need an online account to be scheduled?",
    answer:
      "No. Receptionists can quick-book walk-ins and phone calls right from the Front-Desk Command Center without requiring the patient to register first.",
  },
];

export function FaqCtaFooter() {
  return (
    <>
      {/* FAQ Section */}
      <section
        id="faq"
        className="mx-auto w-full max-w-[1280px] px-4 py-16 sm:px-6 lg:px-8 lg:py-24"
      >
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-12">
          <ScrollReveal className="flex flex-col justify-between gap-6 lg:col-span-5">
            <div>
              <h2 className="font-heading text-3xl leading-[1.12] font-bold tracking-[-0.03em] text-slate-950 sm:text-4xl">
                Questions clinic teams
                <br />
                ask before switching
              </h2>
              <p className="mt-4 max-w-md text-base leading-relaxed text-slate-700">
                Everything you need to know about dual-resource chair
                scheduling, patient privacy, and multi-clinic readiness.
              </p>
              <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-[#EEF7FD] px-4 py-2 text-[13px] font-semibold text-slate-900">
                <ShieldCheck
                  className="size-4 text-[#5B4BD6]"
                  aria-hidden="true"
                />
                <span>Role-based access across all 5 user tiers</span>
              </div>
            </div>

            <div className="relative h-[220px] w-full overflow-hidden rounded-[24px] bg-slate-100 sm:h-[250px]">
              <Image
                src="/images/clinic-team-care.jpg"
                alt="Dental clinicians reviewing a patient odontogram together at a modern sunlit workstation"
                fill
                loading="lazy"
                sizes="(max-width: 1024px) 100vw, 40vw"
                className="object-cover object-center"
              />
            </div>
          </ScrollReveal>

          <ScrollReveal delayMs={90} className="space-y-3 lg:col-span-7">
            {FAQ_ITEMS.map((item, index) => (
              <details
                key={item.question}
                open={index === 0}
                className="group rounded-[22px] bg-[#F7F9FC] px-6 py-5 transition-colors open:bg-[#EFEBFF]/80"
              >
                <summary className="flex list-none items-center justify-between gap-4 font-heading text-base font-bold text-slate-950 cursor-pointer [&::-webkit-details-marker]:hidden">
                  <span>{item.question}</span>
                  <span
                    aria-hidden="true"
                    className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-white text-slate-800 transition-transform duration-200 group-open:rotate-180 group-open:text-[#5B4BD6]"
                  >
                    <ChevronDown className="size-4" />
                  </span>
                </summary>
                <p className="mt-3 max-w-[60ch] pr-6 text-base leading-relaxed text-slate-700">
                  {item.answer}
                </p>
              </details>
            ))}
          </ScrollReveal>
        </div>
      </section>

      {/* Closing Rounded CTA Card */}
      <section className="mx-auto w-full max-w-[1280px] px-4 pb-16 sm:px-6 lg:px-8 lg:pb-20">
        <ScrollReveal className="overflow-hidden rounded-[32px] bg-slate-950 px-6 py-12 text-white sm:px-12 sm:py-16 lg:px-16">
          <div className="flex flex-col items-start justify-between gap-8 lg:flex-row lg:items-center">
            <div className="max-w-xl">
              <h2 className="font-heading text-3xl leading-[1.1] font-bold tracking-[-0.03em] text-white sm:text-4xl lg:text-[2.6rem]">
                Bring calm to your
                <br />
                clinic schedule
              </h2>
              <p className="mt-4 max-w-[54ch] text-base leading-relaxed text-slate-300">
                Browse active Smile dental clinics to book an appointment today,
                or create your account to onboard your practice in minutes.
              </p>
            </div>

            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <Link
                href="/clinics"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-white px-6 text-sm font-semibold text-slate-950 transition-colors hover:bg-[#EFEBFF]"
              >
                <span>Browse Dental Clinics</span>
                <ArrowUpRight className="size-4" aria-hidden="true" />
              </Link>
              <Link
                href="/sign-up"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#6C5CE7] px-6 text-sm font-semibold text-white transition-colors hover:bg-[#5B4BD6]"
              >
                <span>Create Free Account</span>
                <ArrowUpRight className="size-4" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </ScrollReveal>
      </section>

      {/* Editorial Footer */}
      <footer className="bg-[#F8FAFC]">
        <div className="mx-auto w-full max-w-[1280px] px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
          <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <SmileLogo />
              <p className="mt-4 max-w-sm text-sm leading-relaxed text-slate-700">
                Multi-tenant dental practice management, dual-resource dentist
                and chair scheduling, and interactive 32-tooth clinical charting
                built for modern practices.
              </p>
            </div>

            <div className="lg:col-span-2">
              <p className="font-heading text-sm font-bold text-slate-950">
                Platform
              </p>
              <ul className="mt-3.5 space-y-2.5 text-sm text-slate-700">
                <li>
                  <a href="#capabilities" className="hover:text-[#5B4BD6]">
                    Capabilities
                  </a>
                </li>
                <li>
                  <a href="#workflows" className="hover:text-[#5B4BD6]">
                    Clinic Roles
                  </a>
                </li>
                <li>
                  <a href="#live-preview" className="hover:text-[#5B4BD6]">
                    Slot Engine
                  </a>
                </li>
                <li>
                  <a href="#pricing" className="hover:text-[#5B4BD6]">
                    Plans &amp; Pricing
                  </a>
                </li>
              </ul>
            </div>

            <div className="lg:col-span-2">
              <p className="font-heading text-sm font-bold text-slate-950">
                Portals
              </p>
              <ul className="mt-3.5 space-y-2.5 text-sm text-slate-700">
                <li>
                  <Link href="/clinics" className="hover:text-[#5B4BD6]">
                    Clinic Directory
                  </Link>
                </li>
                <li>
                  <Link href="/sign-in" className="hover:text-[#5B4BD6]">
                    Sign In
                  </Link>
                </li>
                <li>
                  <Link href="/sign-up" className="hover:text-[#5B4BD6]">
                    Create Account
                  </Link>
                </li>
                <li>
                  <Link href="/post-login" className="hover:text-[#5B4BD6]">
                    Role Dashboard
                  </Link>
                </li>
              </ul>
            </div>

            <div className="lg:col-span-3">
              <p className="font-heading text-sm font-bold text-slate-950">
                Clinical Readiness
              </p>
              <ul className="mt-3.5 space-y-2.5 text-sm text-slate-700">
                <li>Asia/Manila IANA Slot Precision</li>
                <li>Strict Tenant-Isolated Data</li>
                <li>GCash, Maya &amp; Bank Rails</li>
                <li>
                  <a href="#faq" className="hover:text-[#5B4BD6]">
                    Frequently Asked Questions
                  </a>
                </li>
              </ul>
            </div>
          </div>

          <div className="mt-12 flex flex-col items-start justify-between gap-3 pt-6 text-[13px] text-slate-600 sm:flex-row sm:items-center">
            <p>© 2026 Smile Dental Scheduling System. All rights reserved.</p>
            <p>
              Built for patients, receptionists, dentists, and multi-clinic
              teams.
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}

import { CapabilitiesBento } from "@/components/landing/capabilities-bento";
import { FaqCtaFooter } from "@/components/landing/faq-cta-footer";
import { HeroSection } from "@/components/landing/hero-section";
import { InteractiveSchedulerPreview } from "@/components/landing/interactive-scheduler-preview";
import { LandingNavbar } from "@/components/landing/landing-navbar";
import { PricingSection } from "@/components/landing/pricing-section";
import { RoleSpotlightSection } from "@/components/landing/role-spotlight-section";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-950 selection:bg-[#6C5CE7]/15 selection:text-[#5B4BD6]">
      <LandingNavbar />
      <main className="flex-1">
        <HeroSection />
        <CapabilitiesBento />
        <RoleSpotlightSection />
        <InteractiveSchedulerPreview />
        <PricingSection />
        <FaqCtaFooter />
      </main>
    </div>
  );
}

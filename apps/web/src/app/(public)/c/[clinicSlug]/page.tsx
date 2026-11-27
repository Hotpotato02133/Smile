import { Suspense } from "react";
import { ClinicBookingWizard } from "@/components/booking/clinic-booking-wizard";

async function ClinicSlugResolver({
  params,
}: {
  params: Promise<{ clinicSlug: string }>;
}) {
  const { clinicSlug } = await params;
  return <ClinicBookingWizard clinicSlug={clinicSlug} />;
}

export default function PublicClinicBookingPage({
  params,
}: {
  params: Promise<{ clinicSlug: string }>;
}) {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
          Loading clinic portal…
        </div>
      }
    >
      <ClinicSlugResolver params={params} />
    </Suspense>
  );
}

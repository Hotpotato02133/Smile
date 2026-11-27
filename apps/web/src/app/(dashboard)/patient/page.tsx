import { Suspense } from "react";
import { PatientPortal } from "@/components/patient/patient-portal";

export default function PatientDashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen w-full items-center justify-center bg-[#F6F8FB] p-6 text-sm text-slate-500">
          Loading your patient workspace…
        </div>
      }
    >
      <PatientPortal />
    </Suspense>
  );
}

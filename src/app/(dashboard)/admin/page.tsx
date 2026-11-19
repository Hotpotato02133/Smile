import { ClinicAdminEnvGate } from "@/components/clinic-admin/clinic-admin-shell";
import { ClinicOverview } from "@/components/clinic-admin/clinic-overview";

export default function ClinicAdminOverviewPage() {
  return (
    <ClinicAdminEnvGate>
      <ClinicOverview />
    </ClinicAdminEnvGate>
  );
}

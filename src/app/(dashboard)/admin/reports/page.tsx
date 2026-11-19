import { ClinicAdminEnvGate } from "@/components/clinic-admin/clinic-admin-shell";
import { ClinicReports } from "@/components/clinic-admin/clinic-reports";

export default function ClinicAdminReportsPage() {
  return (
    <ClinicAdminEnvGate>
      <ClinicReports />
    </ClinicAdminEnvGate>
  );
}

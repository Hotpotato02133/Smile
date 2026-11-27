import { ClinicAdminEnvGate } from "@/components/clinic-admin/clinic-admin-shell";
import { DentistsManager } from "@/components/clinic-admin/dentists-manager";

export default function ClinicAdminDentistsPage() {
  return (
    <ClinicAdminEnvGate>
      <DentistsManager />
    </ClinicAdminEnvGate>
  );
}

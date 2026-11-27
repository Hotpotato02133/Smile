import { ChairsManager } from "@/components/clinic-admin/chairs-manager";
import { ClinicAdminEnvGate } from "@/components/clinic-admin/clinic-admin-shell";

export default function ClinicAdminChairsPage() {
  return (
    <ClinicAdminEnvGate>
      <ChairsManager />
    </ClinicAdminEnvGate>
  );
}
